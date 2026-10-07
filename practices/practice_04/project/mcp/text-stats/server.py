"""
MCP exec-server (Python) for tool: text.stats

Compat: supports both mcp v2 (MCPServer) and v1 (FastMCP).

Install in project venv:
  pip install --upgrade pip
  pip install mcp

OpenCode launches this via exec/stdio from opencode.json.
"""
from __future__ import annotations

# Try mcp v2 first, then v1 fallback
try:  # mcp 2.x
    from mcp.server.mcpserver import MCPServer  # type: ignore
    _V2 = True
except Exception:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as MCPServer  # type: ignore
    _V2 = False


server = MCPServer("text-stats")


@server.tool("text.stats", description="Compute length, words count and overLimit flag for a given text.")  # type: ignore
def text_stats(text: str, limit: int | None = None) -> dict:
    if not isinstance(text, str) or len(text) == 0:
        # Per MCP conventions: surface user input error clearly
        raise ValueError("invalid_request: text must be a non-empty string")

    limit = int(limit or 0)
    length = len(text)
    words = len(text.strip().split()) if text.strip() else 0
    over_limit = bool(limit > 0 and length > limit)
    return {"length": length, "words": words, "overLimit": over_limit}


if __name__ == "__main__":
    # stdio transport (OpenCode exec-server uses stdio)
    # v2 exposes run_stdio(); some builds use run()
    run = getattr(server, "run_stdio", None) or getattr(server, "run", None)
    if not run:
        raise RuntimeError("MCP server object has no run/run_stdio method; check installed mcp version")
    run()
