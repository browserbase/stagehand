import os
from browserbase import Browserbase
from dotenv import load_dotenv

load_dotenv()

def create_extension(bb: Browserbase) -> str:
    extension_path = os.getenv("EXTENSION_ZIP_PATH")
    if not extension_path:
        raise ValueError("EXTENSION_ZIP_PATH environment variable is required")

    with open(extension_path, 'rb') as file:
        extension = bb.extensions.create(file=file)

    print("\n\n\n")
    print(f"Extension uploaded with ID: {extension.id}")
    print("Load this extension into your .env file as EXTENSION_ID")
    print("\n\n\n")
    return extension.id

def main():
    api_key = os.getenv("BROWSERBASE_API_KEY")
    if not api_key:
        raise ValueError("BROWSERBASE_API_KEY environment variable is required")

    bb = Browserbase(api_key=api_key)
    create_extension(bb)

if __name__ == "__main__":
    main()
