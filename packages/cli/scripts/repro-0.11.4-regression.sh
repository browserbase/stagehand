#!/bin/bash
# Reproduction script for browse 0.11.4 regression investigation
# Compares behavior between 0.11.3 and 0.11.4

set -e

BROWSE_113="/tmp/browse-test/node_modules/browse/bin/run.js"
BROWSE_114="/tmp/browse-test-114/node_modules/browse/bin/run.js"
ITERATIONS=10

# Results arrays
declare -A RESULTS_113
declare -A RESULTS_114
declare -A ERRORS_114

cleanup() {
  pkill -9 -f "browse daemon" 2>/dev/null || true
  pkill -9 -f "chrome.*stagehand" 2>/dev/null || true
  rm -rf /tmp/browse-daemon-repro-* 2>/dev/null || true
  sleep 1
}

run_test() {
  local version=$1
  local browse_bin=$2
  local scenario=$3
  local daemon_dir="/tmp/browse-daemon-repro-${version}"
  
  export BROWSE_DAEMON_DIR="$daemon_dir"
  
  local exit_code=0
  local stderr_output=""
  
  case "$scenario" in
    "a_normal_reuse")
      # (a) open then open again (normal reuse)
      cleanup
      stderr_output=$(node "$browse_bin" open https://example.com --local --headed 2>&1) || exit_code=$?
      if [ $exit_code -eq 0 ]; then
        sleep 1
        stderr_output=$(node "$browse_bin" open https://example.org --local --headed 2>&1) || exit_code=$?
      fi
      ;;
      
    "b_chrome_killed_open")
      # (b) open, kill chrome, then open
      cleanup
      stderr_output=$(node "$browse_bin" open https://example.com --local --headed 2>&1) || exit_code=$?
      if [ $exit_code -eq 0 ]; then
        sleep 1
        pkill -9 -f "chrome.*stagehand" 2>/dev/null || true
        sleep 1
        stderr_output=$(timeout 15 node "$browse_bin" open https://example.org --local --headed 2>&1) || exit_code=$?
      fi
      ;;
      
    "b_chrome_killed_eval")
      # (b) open, kill chrome, then eval
      cleanup
      stderr_output=$(node "$browse_bin" open https://example.com --local --headed 2>&1) || exit_code=$?
      if [ $exit_code -eq 0 ]; then
        sleep 1
        pkill -9 -f "chrome.*stagehand" 2>/dev/null || true
        sleep 1
        stderr_output=$(timeout 15 node "$browse_bin" eval "1+1" 2>&1) || exit_code=$?
      fi
      ;;
      
    "b_chrome_killed_get")
      # (b) open, kill chrome, then get
      cleanup
      stderr_output=$(node "$browse_bin" open https://example.com --local --headed 2>&1) || exit_code=$?
      if [ $exit_code -eq 0 ]; then
        sleep 1
        pkill -9 -f "chrome.*stagehand" 2>/dev/null || true
        sleep 1
        stderr_output=$(timeout 15 node "$browse_bin" get title 2>&1) || exit_code=$?
      fi
      ;;
      
    "c_daemon_killed")
      # (c) open, kill daemon, then open
      cleanup
      stderr_output=$(node "$browse_bin" open https://example.com --local --headed 2>&1) || exit_code=$?
      if [ $exit_code -eq 0 ]; then
        sleep 1
        DAEMON_PID=$(pgrep -f "browse daemon.*${daemon_dir}" | head -1)
        if [ -n "$DAEMON_PID" ]; then
          kill -9 "$DAEMON_PID" 2>/dev/null || true
        fi
        sleep 1
        stderr_output=$(timeout 15 node "$browse_bin" open https://example.org --local --headed 2>&1) || exit_code=$?
      fi
      ;;
      
    "d_concurrent_open")
      # (d) two concurrent opens
      cleanup
      local pid1 pid2 exit1 exit2
      node "$browse_bin" open https://example.com --local --headed 2>&1 &
      pid1=$!
      node "$browse_bin" open https://example.org --local --headed 2>&1 &
      pid2=$!
      wait $pid1; exit1=$?
      wait $pid2; exit2=$?
      if [ $exit1 -ne 0 ] || [ $exit2 -ne 0 ]; then
        exit_code=1
        stderr_output="concurrent open failed: exit1=$exit1 exit2=$exit2"
      fi
      ;;
      
    "e_fresh_start")
      # (e) fresh first-ever open with no daemon dir
      cleanup
      rm -rf "$daemon_dir" 2>/dev/null || true
      stderr_output=$(node "$browse_bin" open https://example.com --local --headed 2>&1) || exit_code=$?
      ;;
      
    "f_cross_version")
      # (f) daemon dir left by 0.11.3, then run 0.11.4
      # Only run this for 0.11.4
      if [ "$version" = "114" ]; then
        cleanup
        export BROWSE_DAEMON_DIR="/tmp/browse-daemon-repro-cross"
        rm -rf /tmp/browse-daemon-repro-cross 2>/dev/null || true
        # Start with 0.11.3
        node "$BROWSE_113" open https://example.com --local --headed 2>&1 >/dev/null || true
        sleep 1
        # Stop 0.11.3
        node "$BROWSE_113" stop --force 2>&1 >/dev/null || true
        sleep 1
        # Now try 0.11.4
        stderr_output=$(node "$browse_bin" open https://example.org --local --headed 2>&1) || exit_code=$?
      else
        exit_code=0
        stderr_output="SKIP"
      fi
      ;;
      
    "g_custom_daemon_dir")
      # (g) non-default daemon dir
      cleanup
      export BROWSE_DAEMON_DIR="/tmp/browse-custom-daemon-${version}"
      rm -rf "/tmp/browse-custom-daemon-${version}" 2>/dev/null || true
      stderr_output=$(node "$browse_bin" open https://example.com --local --headed 2>&1) || exit_code=$?
      ;;
  esac
  
  echo "$exit_code|$stderr_output"
}

run_scenario() {
  local scenario=$1
  local version=$2
  local browse_bin=$3
  local successes=0
  local failures=0
  local last_error=""
  
  for i in $(seq 1 $ITERATIONS); do
    result=$(run_test "$version" "$browse_bin" "$scenario")
    exit_code=$(echo "$result" | cut -d'|' -f1)
    stderr=$(echo "$result" | cut -d'|' -f2-)
    
    if [ "$exit_code" -eq 0 ]; then
      ((successes++))
    else
      ((failures++))
      last_error="$stderr"
    fi
  done
  
  echo "$successes|$failures|$last_error"
}

echo "===== Browse 0.11.3 vs 0.11.4 Regression Reproduction ====="
echo "Running each scenario $ITERATIONS times per version"
echo ""

SCENARIOS=(
  "a_normal_reuse"
  "b_chrome_killed_open"
  "b_chrome_killed_eval"
  "b_chrome_killed_get"
  "c_daemon_killed"
  "d_concurrent_open"
  "e_fresh_start"
  "f_cross_version"
  "g_custom_daemon_dir"
)

echo "| Scenario | 0.11.3 Pass | 0.11.3 Fail | 0.11.4 Pass | 0.11.4 Fail | 0.11.4 Error |"
echo "|----------|-------------|-------------|-------------|-------------|--------------|"

for scenario in "${SCENARIOS[@]}"; do
  # Run 0.11.3
  result_113=$(run_scenario "$scenario" "113" "$BROWSE_113")
  pass_113=$(echo "$result_113" | cut -d'|' -f1)
  fail_113=$(echo "$result_113" | cut -d'|' -f2)
  
  # Run 0.11.4
  result_114=$(run_scenario "$scenario" "114" "$BROWSE_114")
  pass_114=$(echo "$result_114" | cut -d'|' -f1)
  fail_114=$(echo "$result_114" | cut -d'|' -f2)
  error_114=$(echo "$result_114" | cut -d'|' -f3- | head -c 50)
  
  echo "| $scenario | $pass_113 | $fail_113 | $pass_114 | $fail_114 | $error_114 |"
done

cleanup
echo ""
echo "===== Done ====="
