from crewai import Agent, Task, Crew
from crewai_tools import StagehandTool
from stagehand.schemas import AvailableModel
import os

# Get API keys from environment
browserbase_api_key = os.environ.get("BROWSERBASE_API_KEY")
browserbase_project_id = os.environ.get("BROWSERBASE_PROJECT_ID")
model_api_key = os.environ.get("OPENAI_API_KEY")  # or ANTHROPIC_API_KEY

# Initialize the tool
stagehand_tool = StagehandTool(
    api_key=browserbase_api_key,
    project_id=browserbase_project_id,
    model_api_key=model_api_key,
    model_name=AvailableModel.GPT_4O,
)

# Create an agent
researcher = Agent(
    role="Web Researcher",
    goal="Gather product information from an e-commerce website",
    backstory="I specialize in extracting and analyzing web data.",
    verbose=True,
    tools=[stagehand_tool],
)

# Form submission task
form_submission_task = Task(
    description="""
    Submit a contact form on example.com:
    1. Go to example.com/contact
    2. Fill out the contact form with:
       - Name: John Doe
       - Email: john@example.com
       - Subject: Information Request
       - Message: I would like to learn more about your services
    3. Submit the form
    4. Confirm the submission was successful
    """,
    expected_output="The form should be submitted successfully",
    agent=researcher,
)

# Run the crew
crew = Crew(
    agents=[researcher],
    tasks=[form_submission_task],
    verbose=True,
)

result = crew.kickoff()
print(result)

# Clean up resources
stagehand_tool.close()