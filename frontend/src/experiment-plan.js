// Bounded, visible hypotheses. Never treat assumed prices, costs or formats as facts.
import { MEASURES, scenarioShare } from "./research.js";
export const MAX_SCENARIOS = 84;
export const PRICE_RANGES = [[10,20],[8,18],[12,22]];
export const signed = n => `${n > 0 ? "+" : ""}${Number(n.toFixed(2))}%`;
export const priceLabel = (value, mode) => mode === "relative" ? (value === 0 ? "Current" : signed(value)) : `$${Number(value.toFixed(2))}`;
const contexts = {
  restaurant: { price:"Meal price", factor:"Service format", values:["Takeaway", "Dine-in"], item:"one consistent meal", premise:"The restaurant described in the decision. This is a restaurant-opening or restaurant-pricing experiment, not a marketplace or an assumed small pilot." },
  marketplace: { price:"Basket price", factor:"Fulfillment", values:["Pickup", "Local delivery"], item:"one consistent food basket", premise:"The food marketplace described in the decision, supplied by existing vendors." },
  retail: { price:"Purchase price", factor:"Purchase channel", values:["In-store", "Home delivery"], item:"one consistent product", premise:"The retail business described in the decision." },
  service: { price:"Service price", factor:"Booking method", values:["Book ahead", "Walk in"], item:"one consistent service", premise:"The consumer service described in the decision." },
};
export function budgetFrom(question) {
  const match = question.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k\b)?|\b([\d,]+(?:\.\d+)?)\s*(k\b)?\s*(?:dollars?|usd)\b/i);
  if (!match) return null;
  const n = Number((match[1] || match[3]).replaceAll(",", "")) * (match[2] || match[4] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function priceRangeFrom(question) {
  const match = question.match(/(?:\$\s*(\d+(?:\.\d+)?)\s*(?:-|–|to|and)\s*\$?\s*(\d+(?:\.\d+)?)|\b(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:dollars?|usd)\b)/i);
  if (!match) return null;
  const range=[Number(match[1] || match[3]),Number(match[2] || match[4])];
  if (!(range[0]>0 && range[1]>range[0] && range[1]<=100000)) throw new Error("Use a positive, increasing price range.");
  return range;
}
export function sweep(from, to, count=6) {
  const values=Array.from({length:count},(_,i)=>Number((from+(to-from)*i/(count-1)).toFixed(2)));
  if(new Set(values).size!==count) throw new Error("Choose a wider price range for distinct test points.");
  return values;
}
// New plans test one-percentage-point increments up to 20%; larger ranges stay bounded.
// Missing resolution preserves the six-point design of saved version-3 drafts.
function relativeSweep(percent, resolution) {
  if (resolution !== 1) return sweep(0, percent);
  if (Math.abs(percent) > 20) return sweep(0, percent, 21);
  const direction = Math.sign(percent), magnitude = Math.abs(percent);
  const values = Array.from({length: Math.floor(magnitude) + 1}, (_, i) => i === 0 ? 0 : i * direction);
  if (values.at(-1) !== percent) values.push(percent);
  return values;
}
export function autoPlan(question, route) {
  if (!question?.trim() || question.length > 2000) throw new Error("Describe your decision in under 2,000 characters.");
  if (!["price", "launch", "compare"].includes(route.kind)) throw new Error("Try a decision about what residents would buy, choose or support.");
  const commercial=route.kind!=="compare";
  // Prevent an older planner from applying a marketplace recipe to an explicit restaurant.
  const business=/\b(marketplace|food platform)\b/i.test(question)?"marketplace":/\b(jolli?bee|jolibee|chipotle|restaurant|cafe|café|pizzeria|burger|fried chicken)\b/i.test(question)?"restaurant":contexts[route.business]?route.business:"service";
  const matched=question.match(/([+-]?\d+(?:\.\d+)?)\s*(?:%|percent)/i);
  const percent=matched ? (/\b(lower|reduce|reduc\w*|cut|decrease|drop)\b/i.test(question)?-Math.abs(Number(matched[1])):Number(matched[1])) : 20;
  if(route.kind==="price" && matched && (percent<=-100 || percent===0 || Math.abs(percent)>1000)) throw new Error("Use a price change above −100% and no greater than +1,000%.");
  const explicitRange=priceRangeFrom(question);
  const locations=[...new Set(route.locations || [])].slice(0,2);
  if(commercial && locations.length!==2) throw new Error("The planner must propose two distinct areas for this three-factor experiment. Update the backend and retry.");
  const budget=/\b(budget|have|spend|fund|capital)\b/i.test(question)?budgetFrom(question):null;
  return {version:3,decision:question.trim(),kind:route.kind,business,
    measure:route.measure==="repeat"&&commercial?"frequency":route.measure==="support"&&!commercial?"support":"intent",
    priceMode:route.kind==="price" && !explicitRange?"relative":"absolute",priceRange:explicitRange || [10,20],priceSuggested:!explicitRange,percent,priceResolution:1,
    locations,availableLocations:[...new Set([...(route.available_locations || []),...locations])],
    context:{...structuredClone(contexts[business]),...(/\bbowls?\b/i.test(question)?{item:"one consistent bowl"}:{})},budget,alternatives:explicitAlternatives(question)};
}
export function explicitAlternatives(question) {
  const text=question.match(/:\s*(.+?)[?.]?$/)?.[1]; if(!text)return [];
  const options=text.split(/\s*,\s*|\s+or\s+|\s+vs\.?\s+/i).map(s=>s.trim()).filter(Boolean);
  return options.length>=2&&options.length<=6&&new Set(options.map(s=>s.toLowerCase())).size===options.length?options:[];
}
export function compilePlan(plan) {
  if(plan.version!==3) throw new Error("Replan this older experiment to use the new factor design.");
  const measure=plan.measure==="support"?{question:"Would you support the option described in this scenario?",options:["Would support","Would not support"],indices:[0],metric:"Would support"}:MEASURES[plan.measure];
  if(!measure)throw new Error("Select an outcome to measure.");
  const exp={version:3,decision:plan.decision,kind:plan.kind,question:measure.question,options:[...measure.options],indices:[...measure.indices],metric:plan.measure==="intent"?"Willingness to buy":measure.metric,
    assumptions:`Decision: ${plan.decision}\nEvery scenario is hypothetical and evaluated independently using the identical audience, model and date. 30-day horizon. Stated preferences, not observed demand, sales, profit or a causal forecast.`,scenarios:[],factors:[]};
  if(plan.kind!=="compare") {
    if(plan.locations.length!==2||new Set(plan.locations).size!==2)throw new Error("Choose two distinct areas.");
    if(!contexts[plan.business]||plan.context.values.length!==2||new Set(plan.context.values).size!==2)throw new Error("Choose two distinct business formats.");
    if(plan.priceMode!=="absolute"&&plan.priceMode!=="relative")throw new Error("Invalid price mode.");
    if(plan.priceMode==="absolute"&&(!plan.priceRange.every(Number.isFinite)||plan.priceRange[0]<=0||plan.priceRange[1]<=plan.priceRange[0]||plan.priceRange[1]>100000))throw new Error("Choose a valid price range.");
    if(plan.priceMode==="relative"&&(!Number.isFinite(plan.percent)||plan.percent===0||plan.percent<=-100||plan.percent>1000))throw new Error("Choose a valid price change.");
    const values=plan.priceMode==="absolute"?sweep(...plan.priceRange):relativeSweep(plan.percent,plan.priceResolution);
    exp.priceMode=plan.priceMode;exp.priceAxis=plan.priceMode==="relative"?"Price change":plan.context.price;
    exp.factors=[{id:"location",label:"Location",levels:plan.locations},{id:"price",label:exp.priceAxis,levels:values.map(v=>priceLabel(v,plan.priceMode))},{id:"format",label:plan.context.factor,levels:plan.context.values}];
    if(plan.business==="restaurant"&&plan.measure==="intent")exp.question=`Would you buy ${plan.context.item.replace("one consistent", "a")} from this restaurant at the scenario's price at least once in the next 30 days?`;
    exp.assumptions+=` ${plan.context.premise} Same brand, selection, portion, quality, competing offers and awareness. Vary only location, price and ${plan.context.factor.toLowerCase()}. Compare ${plan.context.item}. No introductory discounts or incentive caps. `;
    exp.assumptions+=plan.priceMode==="relative"?"Prices are relative to an unknown current price. No absolute menu price is assumed.":`Test price per ${plan.context.item} includes any service/delivery charge, excludes tax, and is an unverified hypothesis, not an existing menu price.`;
    if(plan.budget!=null)exp.assumptions+=` User-stated budget: $${plan.budget}. No budget allocation, redemption capacity, operating costs or feasibility are inferred from it.`;
    exp.assumptions+=" Locations are coarse areas, not verified premises. All areas use the same city-wide audience, not separate local demand samples. Unspecified news and prior experiments are excluded. Any attached research context is held fixed across scenarios.";
    exp.scenarios=plan.locations.flatMap(location=>plan.context.values.flatMap(format=>values.map(value=>({
      label:`${location} · ${priceLabel(value,plan.priceMode)} · ${format}`,location,format,price:plan.priceMode==="absolute"?value:undefined,change:plan.priceMode==="relative"?value:undefined,
      description:`Business exactly as described in the decision. Location: ${location}. ${plan.context.factor}: ${format}. ${plan.priceMode==="relative"?`Price: ${value===0?"unchanged current price":`${Math.abs(value)}% ${value<0?"below":"above"} the current price`}.`:`Price of ${plan.context.item}: $${value}, including any fulfillment charge and before tax.`} Everything other than these three factors remains constant.`
    }))));
  } else {
    const alternatives=plan.alternatives.length?plan.alternatives:["Current approach","Proposed change"];
    exp.factors=[{id:"alternative",label:"Alternative",levels:alternatives},{id:"rollout",label:"Availability",levels:["Full availability","Opt-in pilot"]},{id:"presentation",label:"Explanation",levels:["Brief overview","Detailed explanation"]}];
    exp.assumptions+=" The availability and explanation formats are proposed experimental factors, not verified implementation details. The proposal's substance stays identical across explanation lengths; do not invent additional benefits.";
    exp.scenarios=alternatives.flatMap(alternative=>exp.factors[1].levels.flatMap(rollout=>exp.factors[2].levels.map(presentation=>({label:`${alternative} · ${rollout} · ${presentation}`,description:`Evaluate ${alternative} for the stated decision. Availability: ${rollout}. Presentation: ${presentation} of the same proposal, without extra benefits or promises.`}))));
  }
  if(exp.scenarios.length<2||exp.scenarios.length>MAX_SCENARIOS)throw new Error(`Compare up to ${MAX_SCENARIOS} combinations.`);
  return exp;
}
// One curve varies only price. Never connect points from different factor cells.
export function priceSeries(run, selected=0) {
  const reference=run.experiment.scenarios[selected];
  return run.scenarios.map((result,index)=>({result,index,scenario:run.experiment.scenarios[index]}))
    .filter(r=>r.scenario.location===reference.location&&r.scenario.format===reference.format&&Number.isFinite(r.scenario.change??r.scenario.price))
    .sort((a,b)=>(a.scenario.change??a.scenario.price)-(b.scenario.change??b.scenario.price));
}
export function rankScenarios(run) {
  const rows=run.scenarios.map((s,index)=>({index,scenario:run.experiment.scenarios[index],share:scenarioShare(s,run.experiment.indices)})).sort((a,b)=>(b.share??-1)-(a.share??-1)||a.index-b.index);
  let previous=null,rank=0;
  return rows.map((row,i)=>{if(previous===null||Math.abs(row.share-previous)>1e-9)rank=i+1;previous=row.share;return {...row,rank,delta:i===0&&rows[1]?row.share-rows[1].share:null};});
}
