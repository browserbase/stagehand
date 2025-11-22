#!/usr/bin/env python3
"""
Example: Using Stagehand Python SDK with Remote Server

This example demonstrates how to use the Python SDK to connect to a
Stagehand server and execute browser automation tasks.

Usage:
    1. First, start the Node.js server in another terminal:
       npx tsx examples/p2p-server-example.ts

    2. Install the Python dependencies:
       pip install httpx httpx-sse

    3. Then run this Python client:
       python examples/python-client-example.py
"""

import asyncio
import os
from stagehand import Stagehand


async def main():
    server_url = os.getenv("STAGEHAND_SERVER_URL", "http://localhost:3000")

    print("Stagehand Python Client")
    print("=" * 60)
    print(f"Connecting to server at {server_url}...")

    # Create Stagehand instance
    stagehand = Stagehand(
        server_url=server_url,
        verbose=1,
    )

    try:
        # Connect to the remote server and create a session
        await stagehand.init()
        print("✓ Connected to remote server\n")

        # Navigate to a test page
        print("=" * 60)
        print("Navigating to example.com")
        print("=" * 60)
        await stagehand.goto("https://example.com")
        print("✓ Navigated to example.com\n")

        # Test act()
        print("=" * 60)
        print("Testing act()")
        print("=" * 60)
        try:
            act_result = await stagehand.act("scroll to the bottom")
            print(f"✓ Act result: success={act_result.success}, "
                  f"message={act_result.message}, "
                  f"actions={len(act_result.actions)}")
        except Exception as e:
            print(f"✗ Act error: {e}")

        # Test extract()
        print("\n" + "=" * 60)
        print("Testing extract()")
        print("=" * 60)
        try:
            extract_result = await stagehand.extract("extract the page title")
            print(f"✓ Extract result: {extract_result}")
        except Exception as e:
            print(f"✗ Extract error: {e}")

        # Test observe()
        print("\n" + "=" * 60)
        print("Testing observe()")
        print("=" * 60)
        try:
            observe_result = await stagehand.observe("find all links on the page")
            print(f"✓ Observe result: Found {len(observe_result)} actions")
            if observe_result:
                first_action = observe_result[0]
                print(f"  First action: selector={first_action.selector}, "
                      f"description={first_action.description}")
        except Exception as e:
            print(f"✗ Observe error: {e}")

        # Test extract with schema
        print("\n" + "=" * 60)
        print("Testing extract with schema")
        print("=" * 60)
        try:
            schema = {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "heading": {"type": "string"}
                }
            }
            structured_data = await stagehand.extract(
                instruction="extract the page title and main heading",
                schema=schema
            )
            print(f"✓ Structured data: {structured_data}")
        except Exception as e:
            print(f"✗ Structured extract error: {e}")

        print("\n" + "=" * 60)
        print("All tests completed!")
        print("=" * 60)
        print("\nNote: The browser is running on the remote Node.js server.")
        print("      All commands were executed via RPC over HTTP/SSE.\n")

    finally:
        await stagehand.close()


# Alternative example using context manager
async def context_manager_example():
    """Example using Python's async context manager"""
    async with Stagehand(server_url="http://localhost:3000", verbose=1) as stagehand:
        await stagehand.goto("https://example.com")
        data = await stagehand.extract("extract the page title")
        print(f"Page title: {data}")


if __name__ == "__main__":
    asyncio.run(main())
    # Or use the context manager version:
    # asyncio.run(context_manager_example())
