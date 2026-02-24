
import subprocess
import json
import tempfile
import os

def copilot_stream(prompt, cwd=None, *extra):
    """Stream copilot responses as they arrive using SSE format.
    
    Args:
        prompt: The prompt to send to copilot
        cwd: Working directory for the copilot command (optional)
        *extra: Additional arguments
    
    Yields chunks of text as they become available.
    """
    # Write prompt to a temporary file to avoid newline/escaping issues
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt', encoding='utf-8') as tmp:
        tmp.write(prompt)
        tmp_path = tmp.name
    
    try:
        # Read prompt from file instead of passing on command line
        cmd = f'copilot --prompt "@{tmp_path}"'
        if extra:
            cmd += " " + " ".join(extra)
        
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            shell=True
        )
        
        # Read output line by line as it becomes available
        for line in process.stdout:
            line = line.rstrip()  # Remove only trailing whitespace, preserve indentation
            if line:
                yield line
        
        process.wait()
        
        if process.returncode != 0:
            stderr = process.stderr.read()
            print(f"Error: Command returned non-zero exit code {process.returncode}")
            print(f"STDERR: {stderr}")
            yield f"\n[Error: {stderr}]"
            
    except FileNotFoundError as e:
        print(f"FileNotFoundError: {e}")
        yield f"Error: {e}"
    except Exception as e:
        print(f"Unexpected error: {e}")
        yield f"Error: {e}"
    finally:
        # Clean up temporary file
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except:
            pass

def copilot(prompt, cwd=None, *extra):
    """Non-streaming version for backward compatibility.
    
    Args:
        prompt: The prompt to send to copilot
        cwd: Working directory for the copilot command (optional)
        *extra: Additional arguments
    """
    cmd = ["copilot", "--prompt", prompt, *extra]
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False, shell=True)
        if result.returncode != 0:
            print(f"Error: Command returned non-zero exit code {result.returncode}")
            print(f"STDERR: {result.stderr}")
        return result.stdout
    except FileNotFoundError as e:
        print(f"FileNotFoundError: {e}")
        return None
    except Exception as e:
        print(f"Unexpected error: {e}")
        return None

if __name__ == "__main__":
    plan = copilot("Please summarize file tasks\\2025-08-27\\task-0004.md using less than 200 words")
    print(plan)



