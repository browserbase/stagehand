from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential, ChainedTokenCredential, AzureCliCredential, get_bearer_token_provider
import re
import os
 
scope = "api://trapi/.default"
credential = get_bearer_token_provider(ChainedTokenCredential(
    AzureCliCredential(),
    DefaultAzureCredential(
        exclude_cli_credential=True,
        exclude_environment_credential=True,
        exclude_shared_token_cache_credential=True,
        exclude_developer_cli_credential=True,
        exclude_powershell_credential=True,
        exclude_interactive_browser_credential=True,
        exclude_visual_studio_code_credentials=True,
     
        managed_identity_client_id=os.environ.get("DEFAULT_IDENTITY_CLIENT_ID"),
    )
),scope)


api_version = '2024-10-21'  # Ensure this is a valid API version
model_name = 'computer-use-preview'  # Ensure this is a valid model name
model_version = '2025-03-11'  # Ensure this is a valid model version

deployment_name = re.sub(r'[^a-zA-Z0-9-_]', '', f'{model_name}_{model_version}')  # If your Endpoint doesn't have harmonized deployment names, you can use the deployment name directly: see: https://aka.ms/trapi/models
instance = 'redmond/interactive' # See https://aka.ms/trapi/models for the instance name
endpoint = f'https://trapi.research.microsoft.com/{instance}'
 
client = AzureOpenAI(
    azure_endpoint=endpoint,
    azure_ad_token_provider=credential,
    api_version=api_version,
)
 
response = client.chat.completions.create(
    model=deployment_name,
    messages=[
        {
            "role": "user",
            "content": "Give a one word answer, what is the capital of Japan?",
        },
    ]
)
response_content = response.choices[0].message.content
print(response_content)