//! Bounded public evidence collection. Search discovers URLs; only successfully
//! retrieved pages (or explicitly pasted excerpts) become evidence.
use crate::audience_pipeline::{BuildRequest, EvidenceSource, SourceInput};
use anyhow::{anyhow, bail, Context, Result};
use futures::{stream, StreamExt};
use reqwest::{redirect::Policy, Url};
use scraper::{Html, Selector};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    net::{IpAddr, SocketAddr},
    time::Duration,
};

const MAX_SOURCES: usize = 8;
const MAX_TEXT_CHARS: usize = 12_000;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;

pub fn search_configured() -> bool {
    std::env::var("BRAVE_SEARCH_API_KEY").is_ok_and(|key| !key.trim().is_empty())
}

pub async fn collect(request: &BuildRequest) -> Result<(Vec<EvidenceSource>, Vec<String>)> {
    collect_pass(request, false).await
}

// One bounded alternative-source search if the initial pages are all unreadable.
pub async fn collect_automatic(request: &BuildRequest) -> Result<(Vec<EvidenceSource>, Vec<String>)> {
    let (sources, mut warnings) = collect_pass(request, false).await?;
    if !sources.is_empty() || !request.discover || !search_configured() { return Ok((sources, warnings)); }
    warnings.push("The initial search yielded no readable evidence. One alternate-source search excluded commonly blocked discussion/review hosts. No search snippets were substituted for source text.".into());
    let (sources, extra) = collect_pass(request, true).await?;
    warnings.extend(extra);
    warnings.sort(); warnings.dedup();
    Ok((sources, warnings))
}

async fn collect_pass(request: &BuildRequest, alternate: bool) -> Result<(Vec<EvidenceSource>, Vec<String>)> {
    let mut warnings = Vec::new();
    let mut inputs = request
        .sources
        .iter()
        .take(MAX_SOURCES)
        .cloned()
        .collect::<Vec<_>>();
    if request.sources.len() > MAX_SOURCES {
        warnings.push("Only the first eight submitted sources were processed.".into());
    }
    if request.discover && inputs.len() < MAX_SOURCES {
        if search_configured() {
            match discover(request, alternate).await {
                Ok(discovered) => {
                    if discovered.is_empty() {
                        warnings.push("Web discovery returned no source URLs. Try a more specific business or question, in the main question input.".into());
                    }
                    let mut known = inputs.iter().filter_map(|s| s.url.clone()).collect::<HashSet<_>>();
                    for input in discovered {
                        if input.url.as_ref().is_some_and(|url| known.insert(url.clone())) {
                            inputs.push(input);
                        }
                        if inputs.len() == MAX_SOURCES { break; }
                    }
                }
                Err(_) => warnings.push("Public web discovery was unavailable. Retry your question when the search service is available.".into()),
            }
        } else {
            warnings.push("Automatic web discovery is not configured (BRAVE_SEARCH_API_KEY). Submitted public URLs and pasted excerpts can still be processed.".into());
        }
    }
    let results = stream::iter(inputs.into_iter().map(|input| async move {
        let label = input
            .url
            .as_deref()
            .and_then(|raw| Url::parse(raw).ok())
            .and_then(|url| url.host_str().map(str::to_owned))
            .unwrap_or_else(|| "pasted source".into());
        (label, collect_one(input).await)
    }))
    .buffered(3)
    .collect::<Vec<_>>()
    .await;
    let mut sources = Vec::new();
    let mut hashes = HashSet::new();
    for (label, result) in results {
        match result {
            Ok((source, source_warnings)) => {
                warnings.extend(source_warnings);
                if hashes.insert(source.content_hash.clone()) { sources.push(source); }
                else { warnings.push(format!("Duplicate evidence from {label} was omitted; repeated text is not independent corroboration.")); }
            }
            Err(error) => warnings.push(format!("Could not collect {label}: {error}. The unavailable source was skipped; no substitute evidence was invented.")),
        }
    }
    Ok((sources, warnings))
}

// Keep every field represented within the search provider's query limits.
// The question determines the topic; do not force unrelated research into pricing.
fn discovery_query(request: &BuildRequest) -> String {
    let query = format!(
        "{} {} {} customer experiences reviews",
        truncate(if request.business == "Unspecified business" { "" } else { request.business.trim() }, 80),
        truncate(request.question.trim(), 180),
        truncate(request.location.trim(), 50)
    );
    truncate(
        &query
            .split_whitespace()
            .take(40)
            .collect::<Vec<_>>()
            .join(" "),
        350,
    )
}

async fn discover(request: &BuildRequest, alternate: bool) -> Result<Vec<SourceInput>> {
    let key = std::env::var("BRAVE_SEARCH_API_KEY").context("Search not configured")?;
    let query = if alternate {
        format!("{} -site:reddit.com -site:yelp.com -site:tripadvisor.com", truncate(&discovery_query(request), 270))
    } else { discovery_query(request) };
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(12))
        .build()?;
    let response = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .header("X-Subscription-Token", key)
        .query(&[("q", query), ("count", "6".into())])
        .send()
        .await?
        .error_for_status()?;
    let bytes = bounded_body(response).await?;
    let data: serde_json::Value = serde_json::from_slice(&bytes)?;
    Ok(data
        .pointer("/web/results")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .take(6)
        .filter_map(|result| {
            Some(SourceInput {
                url: Some(result.get("url")?.as_str()?.to_owned()),
                title: result
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                text: None,
                kind: "web".into(),
            })
        })
        .collect())
}

async fn collect_one(input: SourceInput) -> Result<(EvidenceSource, Vec<String>)> {
    let mut warnings = Vec::new();
    let (text, title, url, kind) = if let Some(pasted) =
        input.text.as_deref().filter(|text| !text.trim().is_empty())
    {
        // Attribution is not proof the page was fetched. Validate syntax without
        // contacting attribution URLs, which may be offline or access-restricted.
        let attribution = input
            .url
            .as_deref()
            .map(validate_url)
            .transpose()?
            .map(|u| u.to_string());
        let (text, truncated) = bounded_text(pasted.trim());
        if truncated {
            warnings.push("A pasted excerpt was limited to 12,000 characters.".into());
        }
        warnings.push("Pasted evidence is user-supplied; its attribution URL was not fetched or independently verified.".into());
        (
            text,
            input
                .title
                .clone()
                .unwrap_or_else(|| "User-supplied excerpt".into()),
            attribution,
            format!("pasted_{}", normalize_kind(&input.kind)),
        )
    } else {
        let url = input
            .url
            .as_deref()
            .ok_or_else(|| anyhow!("source has neither text nor a public URL"))?;
        let (body, final_url, html) = fetch_public(url).await?;
        let (title, extracted) = if html {
            extract_html(&body)
        } else {
            (None, body)
        };
        let (text, truncated) = bounded_text(extracted.trim());
        if truncated {
            warnings.push(format!(
                "Evidence from {} was limited to 12,000 characters.",
                final_url.host_str().unwrap_or("public source")
            ));
        }
        (
            text,
            title
                .or(input.title)
                .unwrap_or_else(|| final_url.host_str().unwrap_or("Public source").into()),
            Some(final_url.to_string()),
            format!("fetched_{}", normalize_kind(&input.kind)),
        )
    };
    if text.chars().count() < 20 {
        bail!("source contained too little readable text");
    }
    let hash = hex::encode(Sha256::digest(text.as_bytes()));
    Ok((
        EvidenceSource {
            id: format!("src_{}", &hash[..20]),
            content_hash: hash,
            url,
            title: truncate(title.trim(), 300),
            text,
            kind,
            retrieved_at: chrono::Utc::now().to_rfc3339(),
        },
        warnings,
    ))
}

fn normalize_kind(kind: &str) -> &str {
    match kind {
        "review" | "reviews" => "review",
        "interview" => "interview",
        "support" => "support",
        "official" => "official",
        "social" | "reddit" | "x" => "social",
        _ => "web",
    }
}

fn truncate(value: &str, count: usize) -> String {
    value.chars().take(count).collect()
}
fn bounded_text(text: &str) -> (String, bool) {
    (
        truncate(text, MAX_TEXT_CHARS),
        text.chars().count() > MAX_TEXT_CHARS,
    )
}

fn validate_url(raw: &str) -> Result<Url> {
    let mut url = Url::parse(raw).map_err(|_| anyhow!("invalid URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        bail!("only HTTP(S) public URLs are accepted");
    }
    if !url.username().is_empty() || url.password().is_some() {
        bail!("URLs containing credentials are not accepted");
    }
    if !matches!(url.port_or_known_default(), Some(80 | 443)) {
        bail!("only standard public web ports are accepted");
    }
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("URL has no host"))?
        .trim_matches(['[', ']']);
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
        || normalized.ends_with(".internal")
        || !normalized.contains('.') && !normalized.contains(':')
    {
        bail!("local network hosts are not accepted");
    }
    if let Ok(ip) = normalized.parse::<IpAddr>() {
        if !public_ip(ip) {
            bail!("private or reserved addresses are not accepted");
        }
    }
    url.set_fragment(None);
    Ok(url)
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || a == 100 && (64..=127).contains(&b)
                || a == 169 && b == 254
                || a == 172 && (16..=31).contains(&b)
                || a == 192 && (b == 168 || b == 0 || b == 2 || b == 88 && c == 99)
                || a == 198 && (b == 18 || b == 19 || b == 51 && c == 100)
                || a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => {
            // Allow ordinary global unicast only. Exclude transition mechanisms,
            // documentation, multicast, IPv4 mappings, link-local and ULA ranges.
            let segments = ip.segments();
            segments[0] & 0xe000 == 0x2000
                && !(segments[0] == 0x2001 && (segments[1] < 0x0200 || segments[1] == 0x0db8))
                && segments[0] != 0x2002
                && segments[0] != 0x3fff
        }
    }
}

async fn fetch_public(raw: &str) -> Result<(String, Url, bool)> {
    tokio::time::timeout(Duration::from_secs(25), fetch_public_inner(raw))
        .await
        .map_err(|_| anyhow!("source fetch timed out"))?
}

async fn fetch_public_inner(raw: &str) -> Result<(String, Url, bool)> {
    let mut url = validate_url(raw)?;
    for redirect in 0..=MAX_REDIRECTS {
        let host = url
            .host_str()
            .ok_or_else(|| anyhow!("missing public host"))?
            .trim_matches(['[', ']'])
            .to_owned();
        let port = url.port_or_known_default().unwrap_or(443);
        let addresses = tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|_| anyhow!("public source DNS lookup failed"))?
            .collect::<Vec<SocketAddr>>();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
            bail!("DNS resolved to a private or reserved address");
        }
        // Pin the validated addresses and bypass environment proxies to prevent
        // rebinding or proxy resolution from changing the destination.
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .resolve_to_addrs(&host, &addresses)
            .user_agent("SimtraEvidence/1.0 (public audience research)")
            .build()?;
        let response = client
            .get(url.clone())
            .header("Accept", "text/html, text/plain")
            .send()
            .await
            .map_err(|_| anyhow!("public source request failed"))?;
        if response.status().is_redirection() {
            if redirect == MAX_REDIRECTS {
                bail!("too many source redirects");
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| anyhow!("redirect has no valid location"))?;
            let next = url
                .join(location)
                .map_err(|_| anyhow!("invalid redirect URL"))?;
            url = validate_url(next.as_str())?;
            continue;
        }
        if !response.status().is_success() {
            bail!("public source returned HTTP {}", response.status().as_u16());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_html = content_type.starts_with("text/html")
            || content_type.starts_with("application/xhtml+xml");
        if !is_html && !content_type.starts_with("text/plain") {
            bail!("source is not readable HTML or plain text");
        }
        let bytes = bounded_body(response).await?;
        let body = String::from_utf8_lossy(&bytes).into_owned();
        return Ok((body, url, is_html));
    }
    bail!("source redirect limit reached")
}

async fn bounded_body(response: reqwest::Response) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY_BYTES as u64)
    {
        bail!("source exceeds the 2 MiB download limit");
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| anyhow!("could not read source body"))?;
        if body.len() + chunk.len() > MAX_BODY_BYTES {
            bail!("source exceeds the 2 MiB download limit");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn extract_html(body: &str) -> (Option<String>, String) {
    let document = Html::parse_document(body);
    let title = document
        .select(&Selector::parse("title").unwrap())
        .next()
        .map(|node| node.text().collect::<Vec<_>>().join(" "));
    let root = document
        .select(&Selector::parse("main, article, [role=main]").unwrap())
        .next()
        .or_else(|| document.select(&Selector::parse("body").unwrap()).next());
    let Some(root) = root else {
        return (title, String::new());
    };
    let mut fragments = Vec::new();
    for node in root.descendants() {
        let Some(text) = node.value().as_text() else {
            continue;
        };
        let excluded = node
            .ancestors()
            .any(|ancestor| ancestor.value().as_element().is_some_and(excluded_element));
        if excluded || text.trim().is_empty() {
            continue;
        }
        let owner = node
            .ancestors()
            .find(|ancestor| {
                ancestor.value().as_element().is_some_and(|element| {
                    matches!(
                        element.name(),
                        "p" | "li" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote"
                    )
                })
            })
            .map(|ancestor| ancestor.id());
        fragments.push((owner, text.split_whitespace().collect::<Vec<_>>().join(" ")));
    }
    // A text node belongs only to its nearest paragraph/list/quote block. This
    // keeps inline emphasis together and avoids collecting nested paragraphs
    // twice through both a blockquote/list item and its child paragraph.
    let has_blocks = fragments.iter().any(|(owner, _)| owner.is_some());
    let mut blocks: Vec<String> = Vec::new();
    let mut previous_owner = None;
    for (owner, text) in fragments {
        if has_blocks && owner.is_none() {
            continue;
        }
        if owner.is_some() && owner == previous_owner {
            let block = blocks.last_mut().expect("previous block exists");
            block.push(' ');
            block.push_str(&text);
        } else {
            blocks.push(text);
        }
        previous_owner = owner;
    }
    (title, blocks.join("\n"))
}

fn excluded_element(element: &scraper::node::Element) -> bool {
    let obvious_ad = ["id", "class"].iter().any(|attribute| {
        element.attr(attribute).is_some_and(|value| {
            value.split_whitespace().any(|token| {
                matches!(
                    token.to_ascii_lowercase().as_str(),
                    "ad" | "ads"
                        | "advertisement"
                        | "advertising"
                        | "ad-container"
                        | "ad-slot"
                        | "ad-banner"
                )
            })
        })
    });
    matches!(
        element.name(),
        "script" | "style" | "noscript" | "svg" | "template" | "nav" | "footer" | "form"
    ) || element.attr("hidden").is_some()
        || element.attr("aria-hidden") == Some("true")
        || obvious_ad
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_query_is_bounded_and_uses_the_actual_research_question() {
        let mut request: BuildRequest = serde_json::from_value(serde_json::json!({
            "business":"Demo App", "question":"Why do customers care about accessibility?", "location":"San Francisco"
        })).unwrap();
        let query = discovery_query(&request);
        assert!(query.contains("accessibility"));
        assert!(!query.contains("pricing"));
        request.question = "long question ".repeat(200);
        request.business = "business".repeat(30);
        request.location = "location".repeat(40);
        let query = discovery_query(&request);
        assert!(query.chars().count() <= 350);
        assert!(query.split_whitespace().count() <= 40);
    }

    #[test]
    fn blocks_private_reserved_and_credential_urls() {
        for url in [
            "file:///etc/passwd",
            "http://localhost/x",
            "http://127.1",
            "http://2130706433",
            "http://10.0.0.1",
            "http://169.254.169.254",
            "http://192.168.1.1",
            "http://[::1]",
            "http://[::ffff:127.0.0.1]",
            "http://[2001:db8::1]",
            "https://user:password@example.com",
            "https://example.com:8080",
            "http://metadata.google.internal",
        ] {
            assert!(validate_url(url).is_err(), "accepted {url}");
        }
        assert!(validate_url("https://example.com/source#fragment")
            .unwrap()
            .fragment()
            .is_none());
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
        assert!(!public_ip("100.64.0.1".parse().unwrap()));
        assert!(!public_ip("198.51.100.1".parse().unwrap()));
    }

    #[test]
    fn extracts_readable_evidence_without_scripts_hidden_content_or_navigation() {
        let (title, text) = extract_html("<html><head><title>Lunch reviews</title></head><body><nav>tracking</nav><main><h1>Customers</h1><p>Price &amp; pickup matter.</p><script>inventClaims()</script><style>bad</style><p hidden>hidden</p><p aria-hidden='true'>not visible</p></main></body></html>");
        assert_eq!(title.as_deref(), Some("Lunch reviews"));
        assert_eq!(text, "Customers\nPrice & pickup matter.");
    }

    #[test]
    fn inline_emphasis_stays_in_complete_paragraphs_without_nested_duplicates() {
        let (_, text) = extract_html("<main><p>Just picking it up, you could tell: <strong>This is <em>two meals</em></strong>, not one.</p><blockquote><p>I buy <span>lunch</span> here weekly.</p><p>Pickup <b>saves time.</b></p></blockquote><ul><li><p>Compare the <em>price</em> first.</p></li></ul></main>");
        assert_eq!(text, "Just picking it up, you could tell: This is two meals , not one.\nI buy lunch here weekly.\nPickup saves time.\nCompare the price first.");
        assert_eq!(text.matches("I buy").count(), 1);
    }

    #[test]
    fn removes_obvious_ads_and_forms_but_preserves_normal_review_classes() {
        let (_, text) = extract_html("<main><div class='ad-container'><p>Buy this unrelated product.</p></div><form><p>Enter your email.</p></form><nav><p>Next article</p></nav><p class='customer-advice'>I compare menu prices before ordering.</p><p>A visible <span hidden>secret</span>review.</p></main>");
        assert_eq!(
            text,
            "I compare menu prices before ordering.\nA visible review."
        );
    }

    #[test]
    fn falls_back_to_visible_text_when_no_paragraph_blocks_exist() {
        let (_, text) = extract_html("<main><div>Customer feedback</div><div>Pickup matters.</div><script>hidden()</script></main>");
        assert_eq!(text, "Customer feedback\nPickup matters.");
    }

    #[test]
    fn text_bounds_are_unicode_safe() {
        let (text, cut) = bounded_text(&"🍜".repeat(12_001));
        assert!(cut);
        assert_eq!(text.chars().count(), 12_000);
    }

    #[tokio::test]
    async fn pasted_attribution_is_never_reported_as_fetched() {
        let (source, warnings) = collect_one(SourceInput {
            url: Some("https://example.com/review".into()),
            text: Some("I buy lunch weekly and compare the menu prices.".into()),
            title: None,
            kind: "review".into(),
        })
        .await
        .unwrap();
        assert_eq!(source.kind, "pasted_review");
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("not fetched")));
        assert!(source.url.is_some());
    }

    #[tokio::test]
    async fn duplicate_excerpts_are_not_independent_evidence() {
        let input = SourceInput {
            url: None,
            text: Some("I buy lunch weekly and compare the menu prices.".into()),
            title: None,
            kind: "review".into(),
        };
        let request = BuildRequest {
            question: "Lunch pricing?".into(),
            business: "Cafe".into(),
            location: "SF".into(),
            panel_size: 3,
            sources: vec![input.clone(), input],
            discover: false,
            founder_context: String::new(),
            panel_id: None,
        };
        let (sources, warnings) = collect(&request).await.unwrap();
        assert_eq!(sources.len(), 1);
        assert!(warnings.iter().any(|warning| warning.contains("Duplicate")));
    }
}
