// Geographic scenario context is separate from the population being surveyed.
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function areaCount(properties) {
  const count = properties?.mapped_poi_count;
  return Number.isFinite(count) ? `${count.toLocaleString()} mapped places`
    : Number.isFinite(properties?.mapped_food_poi_count)
      ? `${properties.mapped_food_poi_count.toLocaleString()} mapped food places`
      : "Place counts unavailable";
}

export function locationEvidence(context) {
  if (!context) return "";
  const sourceDates = Object.entries(context.sources || {}).map(([name, source]) =>
    `${name === "osm" ? "OpenStreetMap" : "DataSF"}: ${source.retrieved_at || "date unavailable"} (${source.status || "unknown"})`).join(" · ");
  const categories = context.category_counts || context.mapped_poi_counts_by_category;
  return `<details class="res-location"><summary>Location evidence used: ${escape(context.area_name)}</summary>
    <p>${escape(areaCount(context))}${categories ? ` · ${escape(Object.entries(categories).map(([k,v]) => `${k}: ${v}`).join(", "))}` : ""}</p>
    <p>${escape(context.population_scope)}</p><p>${escape(sourceDates)}</p>
    <ul>${(context.limitations || []).map(text => `<li>${escape(text)}</li>`).join("")}</ul>
    <p><a href="https://data.sfgov.org/d/j2bu-swwd" target="_blank" rel="noopener">DataSF boundaries</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></p></details>`;
}

export function initLocationContext({select, note, getLocations}) {
  let features = [], request = 0, mode = "predict", loading = true;
  function renderNote() {
    select.disabled = loading || mode !== "predict" || !features.length;
    if (mode !== "predict") {
      note.textContent = "Location evidence is used in Predict mode. A/B uses its existing comparison flow.";
      return;
    }
    const area = features.find(f => f.id === select.value);
    if (area) {
      const categories = Object.entries(area.properties.category_counts || {})
        .filter(([,count]) => Number.isFinite(count) && count > 0)
        .map(([category,count]) => `${category}: ${count}`).join(" · ");
      note.textContent = `${areaCount(area.properties)}${categories ? ` (${categories})` : ""}. Used in the prediction; your selected audience stays the same. Source coverage may be incomplete.`;
    } else if (features.length) {
      note.textContent = "Choose an area to include its mapped places in the prediction. This does not filter residents to that neighborhood.";
    }
  }
  select.addEventListener("change", renderNote);
  return {
    selectedId: () => mode === "predict" && !select.disabled ? select.value : "",
    setMode(next) { mode = next; renderNote(); },
    async load(city) {
      const token = ++request;
      features = []; loading = true;
      select.replaceChildren(new Option("No location context", ""));
      select.disabled = true;
      note.textContent = city === "sf" ? "Loading mapped places…" : "Location evidence is currently available for San Francisco.";
      if (city !== "sf") { loading = false; return; }
      try {
        const data = await getLocations(city);
        if (token !== request) return;
        features = (data.areas?.features || []).filter(f => f.id && f.properties?.name)
          .sort((a,b) => a.properties.name.localeCompare(b.properties.name));
        for (const feature of features) select.add(new Option(feature.properties.name, feature.id));
        if (!features.length) note.textContent = "No launch areas available from the location source.";
      } catch {
        if (token !== request) return;
        note.textContent = "Location evidence unavailable. Predictions without location context remain available.";
      }
      if (token === request) { loading = false; renderNote(); }
    },
  };
}
