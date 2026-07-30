//go:build !windows

package stagehand

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

func configureChromeProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateChromeProcess(command *exec.Cmd) error {
	if command.Process == nil {
		return nil
	}
	return syscall.Kill(-command.Process.Pid, syscall.SIGTERM)
}

func killChromeProcess(command *exec.Cmd) error {
	if command.Process == nil {
		return nil
	}
	return syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
}

func isFinishedChromeProcessError(err error) bool {
	return errors.Is(err, syscall.ESRCH)
}

func runningAsRoot() bool {
	return os.Geteuid() == 0
}
