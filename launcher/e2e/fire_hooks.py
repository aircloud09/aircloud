"""Run hook commands exactly as written in settings.json, the way Claude Code does (shell + stdin JSON)."""
import json, subprocess, sys, time, os, concurrent.futures as cf
home = os.environ["HOME"]
hooks = json.load(open(f"{home}/.claude/settings.json"))["hooks"]

def cmds(event):
    return [h["hooks"][0]["command"] for h in hooks.get(event, [])
            if "claude-office-hook" in h["hooks"][0]["command"] or "agent_office.py" in h["hooks"][0]["command"]]

def fire(event, payload, env_extra=None):
    out = []
    env = {**os.environ, **(env_extra or {})}
    for c in cmds(event):
        t = time.perf_counter()
        p = subprocess.run(["bash", "-c", c], input=json.dumps(payload), capture_output=True, text=True, env=env, timeout=30)
        out.append((c.split("/")[-1], p.returncode, round(time.perf_counter() - t, 3), p.stdout + p.stderr))
    return out

if __name__ == "__main__":
    mode = sys.argv[1]
    sid = sys.argv[2] if len(sys.argv) > 2 else "e2e-session-1"
    proj = "/home/user/demo-project"
    base = {"session_id": sid, "cwd": proj, "transcript_path": f"{home}/.claude/projects/-home-user-demo-project/{sid}.jsonl", "hook_event_name": ""}
    env = {"CLAUDE_PROJECT_DIR": proj}
    if mode == "start-burst":
        # 3 sessions/hooks at once
        with cf.ThreadPoolExecutor(3) as ex:
            for r in ex.map(lambda i: fire("SessionStart", {**base, "session_id": f"{sid}-{i}" if i else sid, "source": "startup"}, env), range(3)):
                print(r)
    elif mode == "start":
        print(fire("SessionStart", {**base, "source": "startup"}, env))
    elif mode == "work":
        print(fire("UserPromptSubmit", {**base, "prompt": "README.md 읽고 요약해줘"}, env))
        for i, (tool, inp) in enumerate([("Read", {"file_path": f"{proj}/README.md"}), ("Bash", {"command": "ls -la"}), ("Edit", {"file_path": f"{proj}/a.py", "old_string": "a", "new_string": "b"})]):
            tu = {"tool_name": tool, "tool_input": inp, "tool_use_id": f"toolu_{i}"}
            print(fire("PreToolUse", {**base, **tu}, env))
            time.sleep(float(os.environ.get("STEP", "2")))
            print(fire("PostToolUse", {**base, **tu, "tool_response": {"ok": True}}, env))
    elif mode == "stop":
        print(fire("Stop", {**base, "stop_hook_active": False}, env))
