"""Example usage of the Stagehand Python SDK stubs."""

from stagehand import StagehandClient, StagehandSDKNotImplementedError


def main() -> None:
    client = StagehandClient()
    try:
        client.act("inspect_page", agent="default", params={"url": "https://example.com"})
    except StagehandSDKNotImplementedError as exc:
        print(exc)


if __name__ == "__main__":
    main()
