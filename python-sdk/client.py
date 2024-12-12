# stagehand/client.py
import os
import asyncio
import subprocess
from typing import Optional, Dict, Any, Union
from pathlib import Path
import httpx
class StagehandServer:
    def __init__(self):
        self.server_process = None
        self.server_url = "http://localhost:3000"
    
    async def ensure_server_running(self):
        if self.server_process is None:
            # Start NextJS server in background
            server_dir = Path(__file__).parent / "server"
            self.server_process = subprocess.Popen(
                ["npm", "run", "start"],
                cwd=server_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            # Wait for server to be ready
            await self._wait_for_server()
    
    async def _wait_for_server(self, timeout: int = 30):
        import httpx
        start_time = asyncio.get_event_loop().time()
        while True:
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get(f"{self.server_url}/api/health")
                    if response.status_code == 200:
                        return
            except:
                if asyncio.get_event_loop().time() - start_time > timeout:
                    raise TimeoutError("Server failed to start")
                await asyncio.sleep(0.5)

class Stagehand:
    def __init__(
        self,
        env: str = "BROWSERBASE",
        api_key: Optional[str] = None,
        project_id: Optional[str] = None,
        verbose: int = 0,
        **kwargs
    ):
        self._server = StagehandServer()
        self.config = {
            "env": env,
            "apiKey": api_key or os.getenv("BROWSERBASE_API_KEY"),
            "projectId": project_id or os.getenv("BROWSERBASE_PROJECT_ID"),
            "verbose": verbose,
            **kwargs
        }
        self._initialized = False

    async def init(self, **kwargs):
        await self._server.ensure_server_running()
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._server.server_url}/api/init",
                json={"config": self.config, **kwargs}
            )
            self._initialized = True
            return response.json()

    async def act(
        self,
        action: str,
        use_vision: Union[str, bool] = "fallback",
        variables: Dict[str, Any] = None,
        **kwargs
    ):
        if not self._initialized:
            await self.init()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._server.server_url}/api/act",
                json={
                    "action": action,
                    "useVision": use_vision,
                    "variables": variables or {},
                    **kwargs
                }
            )
            return response.json()

    async def extract(self, instruction: str, schema: Dict, **kwargs):
        if not self._initialized:
            await self.init()
            
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._server.server_url}/api/extract",
                json={
                    "instruction": instruction,
                    "schema": schema,
                    **kwargs
                }
            )
            return response.json()

    async def close(self):
        if self._server.server_process:
            self._server.server_process.terminate()
            self._server.server_process = None