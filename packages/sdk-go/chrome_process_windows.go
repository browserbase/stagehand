//go:build windows

package stagehand

import (
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
	taskkill := exec.Command(
		"taskkill",
		"/PID",
		strconv.Itoa(command.Process.Pid),
		"/T",
		"/F",
	)
	return taskkill.Run()
}

func killChromeProcess(command *exec.Cmd) error {
	if command.Process == nil {
		return nil
	}
	return command.Process.Kill()
}

func runningAsRoot() bool {
	return false
}
