import os

from managed_deepagents import define_deep_agent
from tools.stagehand import run, screenshot, snapshot

agent = define_deep_agent(
    name="stagehand-browser-agent",
    model=os.environ.get("DEEPAGENTS_MODEL", "openai:gpt-5.6-luna"),
    tools=[run, snapshot, screenshot],
)
