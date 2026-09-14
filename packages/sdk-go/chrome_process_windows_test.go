//go:build windows

package stagehand

import (
	"errors"
	"os/exec"
	"reflect"
	"testing"
)

func TestConfigureChromeProcessUsesDedicatedProcessGroupWindows(t *testing.T) {
	command := exec.Command("cmd", "/C", "exit 0")
	configureChromeProcess(command)
	if command.SysProcAttr == nil ||
		command.SysProcAttr.CreationFlags&createNewProcessGroup == 0 {
		t.Fatalf(
			"SysProcAttr = %#v, want CreationFlags to contain %#x",
			command.SysProcAttr,
			createNewProcessGroup,
		)
	}
}

func TestTaskkillArgsPreserveGracefulThenForcefulShutdown(t *testing.T) {
	if got, want := taskkillArgs(42, false), []string{"/PID", "42", "/T"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("graceful taskkill args = %#v, want %#v", got, want)
	}
	if got, want := taskkillArgs(42, true), []string{"/PID", "42", "/T", "/F"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("forceful taskkill args = %#v, want %#v", got, want)
	}
}

func TestIgnoreFinishedProcessErrorWindows(t *testing.T) {
	exitError := exec.Command("cmd", "/C", "exit /B 128").Run()
	if exitError == nil {
		t.Fatal("cmd exit 128 returned nil")
	}
	if err := ignoreFinishedProcessError(exitError); err != nil {
		t.Fatalf("ignoreFinishedProcessError(exit 128) = %v, want nil", err)
	}

	sentinel := errors.New("permission denied")
	if err := ignoreFinishedProcessError(sentinel); !errors.Is(err, sentinel) {
		t.Fatalf("ignoreFinishedProcessError() = %v, want %v", err, sentinel)
	}
}
