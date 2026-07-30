//go:build windows

package stagehand

import (
	"errors"
	"os/exec"
	"strconv"
	"syscall"
)

const createNewProcessGroup = 0x00000200

func configureChromeProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
}

func terminateChromeProcess(command *exec.Cmd) error {
	if command.Process == nil {
		return nil
	}
	return exec.Command("taskkill", taskkillArgs(command.Process.Pid, false)...).Run()
}

func killChromeProcess(command *exec.Cmd) error {
	if command.Process == nil {
		return nil
	}
	return exec.Command("taskkill", taskkillArgs(command.Process.Pid, true)...).Run()
}

func taskkillArgs(pid int, force bool) []string {
	args := []string{"/PID", strconv.Itoa(pid), "/T"}
	if force {
		args = append(args, "/F")
	}
	return args
}

func isFinishedChromeProcessError(err error) bool {
	var exitErr *exec.ExitError
	return errors.As(err, &exitErr) && exitErr.ExitCode() == 128
}

func runningAsRoot() bool {
	return false
}
