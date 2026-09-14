//go:build !windows

package stagehand

import (
	"errors"
	"os/exec"
	"syscall"
	"testing"
	"time"
)

func TestConfigureChromeProcessUsesDedicatedProcessGroup(t *testing.T) {
	command := exec.Command("sh", "-c", "exit 0")
	configureChromeProcess(command)
	if command.SysProcAttr == nil || !command.SysProcAttr.Setpgid {
		t.Fatalf("SysProcAttr = %#v, want Setpgid", command.SysProcAttr)
	}
}

func TestChromeProcessGroupTermination(t *testing.T) {
	tests := []struct {
		name   string
		signal func(*exec.Cmd) error
	}{
		{name: "terminate", signal: terminateChromeProcess},
		{name: "kill", signal: killChromeProcess},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			command := exec.Command("sh", "-c", "trap 'exit 0' TERM; sleep 30 & wait")
			configureChromeProcess(command)
			if err := command.Start(); err != nil {
				t.Fatalf("start process group: %v", err)
			}
			process := newChromeProcess(command)
			t.Cleanup(func() {
				select {
				case <-process.done:
					return
				default:
				}
				_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
				select {
				case <-process.done:
				case <-time.After(3 * time.Second):
					t.Errorf("process group did not exit during cleanup")
				}
			})

			processGroup, err := syscall.Getpgid(command.Process.Pid)
			if err != nil {
				t.Fatalf("get process group: %v", err)
			}
			if processGroup != command.Process.Pid {
				t.Fatalf("process group = %d, want %d", processGroup, command.Process.Pid)
			}
			if err := test.signal(command); err != nil {
				t.Fatalf("%s process group: %v", test.name, err)
			}
			select {
			case <-process.done:
			case <-time.After(3 * time.Second):
				t.Fatalf("%s did not stop process group", test.name)
			}
			waitForProcessGroupRemoval(t, command.Process.Pid)
		})
	}
}

func TestIgnoreFinishedProcessErrorUnix(t *testing.T) {
	if err := ignoreFinishedProcessError(syscall.ESRCH); err != nil {
		t.Fatalf("ignoreFinishedProcessError(ESRCH) = %v, want nil", err)
	}
	sentinel := errors.New("permission denied")
	if err := ignoreFinishedProcessError(sentinel); !errors.Is(err, sentinel) {
		t.Fatalf("ignoreFinishedProcessError() = %v, want %v", err, sentinel)
	}
}

func waitForProcessGroupRemoval(t *testing.T, processGroup int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		err := syscall.Kill(-processGroup, 0)
		if errors.Is(err, syscall.ESRCH) {
			return
		}
		if err != nil {
			t.Fatalf("probe process group: %v", err)
		}
		if time.Now().After(deadline) {
			t.Fatalf("process group %d still exists", processGroup)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
