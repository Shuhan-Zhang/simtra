import { test } from "node:test";
import assert from "node:assert/strict";
import { readExecutionStream, executionCounts } from "../src/execution-log.js";

function response(text, width = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(controller) {
    for(let i=0;i<bytes.length;i+=width) controller.enqueue(bytes.slice(i,i+width));
    controller.close();
  }}));
}
test("execution stream handles split UTF-8 and distinguishes requests from cache hits", async () => {
  const events=[];
  const lines=[{type:"log",event:{kind:"model.request",message:"Jev → request"}},{type:"log",event:{kind:"model.cache_hit"}},{type:"result",data:{scenarios:[1,2]}}];
  const result=await readExecutionStream(response(lines.map(JSON.stringify).join("\n")),e=>events.push(e));
  assert.deepEqual(result,{scenarios:[1,2]}); assert.equal(events[0].message,"Jev → request");
  assert.deepEqual(executionCounts(events),{requests:1,cacheHits:1,retries:0});
});
test("failure preserves server trace and never returns partial results",async()=>{
  await assert.rejects(readExecutionStream(response(JSON.stringify({type:"error",error:"Missing key",trace:{provider_requests:0}}))),e=>e.message==="Missing key"&&e.trace.provider_requests===0);
});
test("truncated, malformed and unexpected streams fail closed",async()=>{
  await assert.rejects(readExecutionStream(response('{"type":"log","event":{}}\n')),/ended before/);
  await assert.rejects(readExecutionStream(response('{"type":')),SyntaxError);
  await assert.rejects(readExecutionStream(response('{"type":"unknown"}')),/Unknown/);
  await assert.rejects(readExecutionStream(response('{"type":"result","data":{}}\n{"type":"log","event":{}}')),/after/);
});
