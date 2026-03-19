#!/usr/bin/env python3
import subprocess
import sys
import os
import glob

def test_script(script_path):
    """Test a single Python script and return success/failure status"""
    try:
        result = subprocess.run([sys.executable, script_path], 
                              capture_output=True, 
                              text=True, 
                              timeout=60)
        
        success = result.returncode == 0
        output_lines = len(result.stdout.split('\n'))
        error_msg = result.stderr.strip() if result.stderr.strip() else None
        
        return {
            'script': os.path.basename(script_path),
            'path': script_path,
            'success': success,
            'return_code': result.returncode,
            'output_lines': output_lines,
            'error': error_msg
        }
    except subprocess.TimeoutExpired:
        return {
            'script': os.path.basename(script_path),
            'path': script_path,
            'success': False,
            'return_code': -1,
            'output_lines': 0,
            'error': 'TIMEOUT'
        }
    except Exception as e:
        return {
            'script': os.path.basename(script_path),
            'path': script_path,
            'success': False,
            'return_code': -1,
            'output_lines': 0,
            'error': str(e)
        }

def main():
    # Find all Python files in subdirectories (excluding debug files)
    verbs_dir = r"d:\repos\stagehand\auto_verbs\verbs"
    
    # Get all Python files, excluding _debug.py files
    pattern = os.path.join(verbs_dir, "*", "*.py")
    all_files = glob.glob(pattern)
    
    # Filter out debug and utility files
    main_files = [f for f in all_files if not any(skip in os.path.basename(f) 
                  for skip in ['_debug.py', '_inspect.py', '__pycache__'])]
    
    print(f"Testing {len(main_files)} Python scripts...")
    print("=" * 60)
    
    results = []
    successful = []
    failed = []
    
    for i, script_path in enumerate(main_files, 1):
        print(f"[{i}/{len(main_files)}] Testing {os.path.basename(script_path)}...", end=" ")
        sys.stdout.flush()
        
        result = test_script(script_path)
        results.append(result)
        
        if result['success']:
            print("✓ PASS")
            successful.append(result)
        else:
            print("✗ FAIL")
            failed.append(result)
    
    print("=" * 60)
    print(f"SUMMARY: {len(successful)} passed, {len(failed)} failed")
    print("=" * 60)
    
    if failed:
        print("\nFAILED SCRIPTS:")
        for result in failed:
            error_msg = result['error'] or f"Exit code {result['return_code']}"
            print(f"  ✗ {result['script']}: {error_msg}")
    
    if successful:
        print(f"\nSUCCESSFUL SCRIPTS ({len(successful)}):")
        for result in successful:
            print(f"  ✓ {result['script']}")

if __name__ == "__main__":
    main()