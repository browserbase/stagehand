"""
Stagehand Python SDK

A lightweight Python client for the Stagehand browser automation framework.
Connects to a remote Stagehand server (Node.js) and executes browser automation tasks.

Dependencies:
    pip install httpx

Usage:
    from stagehand import Stagehand

    async def main():
        stagehand = Stagehand(server_url="http://localhost:3000")
        await stagehand.init()

        await stagehand.goto("https://example.com")
        result = await stagehand.act("click the login button")
        data = await stagehand.extract("extract the page title")

        await stagehand.close()
"""

import json
from typing import Any, Dict, List, Optional, Union
import httpx


class StagehandError(Exception):
    """Base exception for Stagehand errors"""
    pass


class StagehandAPIError(StagehandError):
    """API-level errors from the Stagehand server"""
    pass


class StagehandConnectionError(StagehandError):
    """Connection errors when communicating with the server"""
    pass


class Action:
    """Represents a browser action returned by observe()"""

    def __init__(self, data: Dict[str, Any]):
        self.selector = data.get("selector")
        self.description = data.get("description")
        self.backend_node_id = data.get("backendNodeId")
        self.method = data.get("method")
        self.arguments = data.get("arguments", [])
        self._raw = data

    def __repr__(self):
        return f"Action(selector={self.selector!r}, description={self.description!r})"

    def to_dict(self) -> Dict[str, Any]:
        """Convert back to dict for sending to API"""
        return self._raw


class ActResult:
    """Result from act() method"""

    def __init__(self, data: Dict[str, Any]):
        self.success = data.get("success", False)
        self.message = data.get("message", "")
        self.actions = [Action(a) for a in data.get("actions", [])]
        self._raw = data

    def __repr__(self):
        return f"ActResult(success={self.success}, message={self.message!r})"


class Stagehand:
    """
    Main Stagehand client for browser automation.

    Connects to a remote Stagehand server and provides methods for browser automation:
    - act: Execute actions on the page
    - extract: Extract data from the page
    - observe: Observe possible actions on the page
    - goto: Navigate to a URL
    """

    def __init__(
        self,
        server_url: str = "http://localhost:3000",
        verbose: int = 0,
        timeout: float = 120.0,
    ):
        """
        Initialize the Stagehand client.

        Args:
            server_url: URL of the Stagehand server (default: http://localhost:3000)
            verbose: Verbosity level 0-2 (default: 0)
            timeout: Request timeout in seconds (default: 120)
        """
        self.server_url = server_url.rstrip("/")
        self.verbose = verbose
        self.timeout = timeout
        self.session_id: Optional[str] = None
        self._client = httpx.AsyncClient(timeout=timeout)

    async def init(self, **options) -> None:
        """
        Initialize a browser session on the remote server.

        Args:
            **options: Additional options to pass to the server (e.g., model, verbose, etc.)
                      If env is not specified, defaults to "LOCAL"
        """
        if self.session_id:
            raise StagehandError("Already initialized. Call close() first.")

        # Default config for server-side browser session
        session_config = {
            "env": "LOCAL",
            "verbose": self.verbose,
            **options
        }

        try:
            response = await self._client.post(
                f"{self.server_url}/v1/sessions/start",
                json=session_config,
            )
            response.raise_for_status()
            data = response.json()

            self.session_id = data.get("sessionId")
            if not self.session_id:
                raise StagehandAPIError("Server did not return a sessionId")

            if self.verbose > 0:
                print(f"✓ Initialized session: {self.session_id}")

        except httpx.HTTPError as e:
            raise StagehandConnectionError(f"Failed to connect to server: {e}")

    async def goto(
        self,
        url: str,
        options: Optional[Dict[str, Any]] = None,
        frame_id: Optional[str] = None,
    ) -> Any:
        """
        Navigate to a URL.

        Args:
            url: The URL to navigate to
            options: Navigation options (waitUntil, timeout, etc.)
            frame_id: Optional frame ID to navigate

        Returns:
            Navigation response
        """
        return await self._execute(
            method="navigate",
            args={
                "url": url,
                "options": options,
                "frameId": frame_id,
            }
        )

    async def act(
        self,
        instruction: Union[str, Action],
        options: Optional[Dict[str, Any]] = None,
        frame_id: Optional[str] = None,
    ) -> ActResult:
        """
        Execute an action on the page.

        Args:
            instruction: Natural language instruction or Action object
            options: Additional options (model, variables, timeout, etc.)
            frame_id: Optional frame ID to act on

        Returns:
            ActResult with success status and executed actions
        """
        input_data = instruction.to_dict() if isinstance(instruction, Action) else instruction

        # Build request matching server schema
        request_data = {"input": input_data}
        if options is not None:
            request_data["options"] = options
        if frame_id is not None:
            request_data["frameId"] = frame_id

        result = await self._execute(method="act", args=request_data)

        return ActResult(result)

    async def extract(
        self,
        instruction: Optional[str] = None,
        schema: Optional[Dict[str, Any]] = None,
        options: Optional[Dict[str, Any]] = None,
        frame_id: Optional[str] = None,
    ) -> Any:
        """
        Extract data from the page.

        Args:
            instruction: Natural language instruction for what to extract
            schema: JSON schema defining the expected output structure
            options: Additional options (model, selector, timeout, etc.)
            frame_id: Optional frame ID to extract from

        Returns:
            Extracted data matching the schema (if provided) or default extraction
        """
        # Build request matching server schema
        request_data = {}
        if instruction is not None:
            request_data["instruction"] = instruction
        if schema is not None:
            request_data["schema"] = schema
        if options is not None:
            request_data["options"] = options
        if frame_id is not None:
            request_data["frameId"] = frame_id

        return await self._execute(method="extract", args=request_data)

    async def observe(
        self,
        instruction: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
        frame_id: Optional[str] = None,
    ) -> List[Action]:
        """
        Observe possible actions on the page.

        Args:
            instruction: Natural language instruction for what to observe
            options: Additional options (model, selector, timeout, etc.)
            frame_id: Optional frame ID to observe

        Returns:
            List of Action objects representing possible actions
        """
        # Build request matching server schema
        request_data = {}
        if instruction is not None:
            request_data["instruction"] = instruction
        if options is not None:
            request_data["options"] = options
        if frame_id is not None:
            request_data["frameId"] = frame_id

        result = await self._execute(method="observe", args=request_data)

        return [Action(action) for action in result]

    async def agent_execute(
        self,
        instruction: str,
        agent_config: Optional[Dict[str, Any]] = None,
        execute_options: Optional[Dict[str, Any]] = None,
        frame_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Execute an agent task.

        Args:
            instruction: The task instruction for the agent
            agent_config: Agent configuration (model, systemPrompt, etc.)
            execute_options: Execution options (maxSteps, highlightCursor, etc.)
            frame_id: Optional frame ID to execute in

        Returns:
            Agent execution result
        """
        config = agent_config or {}
        exec_opts = execute_options or {}
        exec_opts["instruction"] = instruction

        return await self._execute(
            method="agentExecute",
            args={
                "agentConfig": config,
                "executeOptions": exec_opts,
                "frameId": frame_id,
            }
        )

    async def close(self) -> None:
        """Close the session and cleanup resources."""
        if self.session_id:
            try:
                await self._client.post(
                    f"{self.server_url}/v1/sessions/{self.session_id}/end"
                )
                if self.verbose > 0:
                    print(f"✓ Closed session: {self.session_id}")
            except Exception as e:
                if self.verbose > 0:
                    print(f"Warning: Failed to close session: {e}")
            finally:
                self.session_id = None

        await self._client.aclose()

    async def _execute(self, method: str, args: Dict[str, Any]) -> Any:
        """
        Execute a method on the remote server using SSE streaming.

        Args:
            method: The method name (act, extract, observe, navigate, agentExecute)
            args: Arguments to pass to the method

        Returns:
            The result from the server
        """
        if not self.session_id:
            raise StagehandError("Not initialized. Call init() first.")

        url = f"{self.server_url}/v1/sessions/{self.session_id}/{method}"

        # Create a new client for each request with no connection pooling
        limits = httpx.Limits(max_keepalive_connections=0, max_connections=1)
        async with httpx.AsyncClient(timeout=self.timeout, limits=limits) as client:
            try:
                async with client.stream(
                    "POST",
                    url,
                    json=args,
                    headers={"x-stream-response": "true"},
                ) as response:
                    response.raise_for_status()

                    result = None

                    async for line in response.aiter_lines():
                        if not line.strip() or not line.startswith("data: "):
                            continue

                        # Parse SSE data
                        data_str = line[6:]  # Remove "data: " prefix
                        try:
                            event = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        event_type = event.get("type")
                        event_data = event.get("data", {})

                        if event_type == "log":
                            # Handle log events
                            if self.verbose > 0:
                                category = event_data.get("category", "")
                                message = event_data.get("message", "")
                                level = event_data.get("level", 0)
                                if level <= self.verbose:
                                    print(f"[{category}] {message}")

                        elif event_type == "system":
                            # System events contain the result
                            status = event_data.get("status")
                            if "result" in event_data:
                                result = event_data["result"]
                            elif "error" in event_data:
                                raise StagehandAPIError(event_data["error"])

                            # Break after receiving finished status
                            if status == "finished":
                                break

                    if result is None:
                        raise StagehandAPIError("No result received from server")

                    return result

            except httpx.HTTPStatusError as e:
                error_msg = f"HTTP {e.response.status_code}"
                try:
                    error_text = await e.response.aread()
                    error_msg += f": {error_text.decode()}"
                except Exception:
                    pass
                raise StagehandAPIError(error_msg)
            except httpx.HTTPError as e:
                raise StagehandConnectionError(f"Connection error: {e}")

    async def __aenter__(self):
        """Context manager entry"""
        await self.init()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        await self.close()


# Example usage
if __name__ == "__main__":
    import asyncio

    async def example():
        # Create and initialize Stagehand client
        stagehand = Stagehand(
            server_url="http://localhost:3000",
            verbose=1,
        )

        try:
            await stagehand.init()

            # Navigate to a page
            print("\n=== Navigating to example.com ===")
            await stagehand.goto("https://example.com")

            # Extract data
            print("\n=== Extracting page title ===")
            data = await stagehand.extract("extract the page title")
            print(f"Extracted: {data}")

            # Observe actions
            print("\n=== Observing actions ===")
            actions = await stagehand.observe("find all links on the page")
            print(f"Found {len(actions)} actions")
            if actions:
                print(f"First action: {actions[0]}")

            # Execute an action
            print("\n=== Executing action ===")
            result = await stagehand.act("scroll to the bottom")
            print(f"Result: {result}")

        finally:
            await stagehand.close()

    # Alternative: using context manager
    async def example_with_context_manager():
        async with Stagehand(server_url="http://localhost:3000") as stagehand:
            await stagehand.goto("https://example.com")
            data = await stagehand.extract("extract the page title")
            print(data)

    # Run the example
    asyncio.run(example())
