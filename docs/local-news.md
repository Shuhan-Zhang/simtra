# Local news refresh

The local backend refreshes news every 24 hours using the existing Brave Search key. NewsAPI is preferred when its key is configured; Brave is the fallback. Failed or empty refreshes preserve the previous cache.

Local settings in the ignored `.env`:

```dotenv
NEWS_CACHE_DIR=.local-memory/news
NEWS_REFRESH_HOURS=24
```

The runtime cache is seeded from `data/news/*.json` and lives under the ignored `.local-memory/` directory, so automatic updates do not modify committed news files. Restart the backend after changing these settings. Without `NEWS_CACHE_DIR`, the default remains `data/news`; without a positive refresh interval, scheduled refresh is disabled.

The feed keeps up to 50 dated, linked stories from the past week, including source-provided images. Model context remains separately limited to six summaries. Search-provider dates may reflect publication or modification time.
