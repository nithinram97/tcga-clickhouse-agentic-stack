"""OpenAI-compatible HTTP wrapper around the LangGraph analyst; Langfuse-traced.
LibreChat consumes this as a custom endpoint."""
from __future__ import annotations
import json, os, time, uuid
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from graph import analyst_graph

MODEL_ID = os.getenv("AGENT_MODEL_ID", "tcga-analyst")
_callbacks = []
try:
    from langfuse.langchain import CallbackHandler
    if os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"):
        _callbacks = [CallbackHandler()]
except Exception as exc:
    print(f"[agent] Langfuse tracing disabled: {exc}", flush=True)

app = FastAPI(title="TCGA Analyst Agent")

class ChatMessage(BaseModel):
    role: str
    content: str | list | None = None

class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage]
    stream: bool = False

def _latest_user_question(messages):
    for m in reversed(messages):
        if m.role == "user":
            if isinstance(m.content, str): return m.content
            if isinstance(m.content, list):
                return " ".join(p.get("text","") for p in m.content if isinstance(p, dict))
    return ""

def _run_agent(question, session_id):
    config = {"callbacks": _callbacks,
        "metadata": {"langfuse_session_id": session_id, "endpoint": "tcga-analyst"},
        "run_name": "tcga_analyst"}
    return analyst_graph.invoke({"question": question}, config=config).get("answer", "(no answer produced)")

@app.get("/health")
def health(): return {"status": "ok"}

@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "tcga-agentic-stack"}]}

@app.post("/v1/chat/completions")
def chat_completions(req: ChatRequest):
    question = _latest_user_question(req.messages)
    session_id = str(uuid.uuid4())
    cid = f"chatcmpl-{uuid.uuid4().hex[:24]}"; created = int(time.time())
    if not req.stream:
        answer = _run_agent(question, session_id)
        return {"id": cid, "object": "chat.completion", "created": created, "model": MODEL_ID,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
    def sse():
        head = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": MODEL_ID,
            "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]}
        yield f"data: {json.dumps(head)}\n\n"
        answer = _run_agent(question, session_id)
        body = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": MODEL_ID,
            "choices": [{"index": 0, "delta": {"content": answer}, "finish_reason": None}]}
        yield f"data: {json.dumps(body)}\n\n"
        tail = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": MODEL_ID,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        yield f"data: {json.dumps(tail)}\n\n"; yield "data: [DONE]\n\n"
    return StreamingResponse(sse(), media_type="text/event-stream")
