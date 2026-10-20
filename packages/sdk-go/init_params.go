package stagehand

import "errors"

func (value *StagehandInitParams) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("stagehand.StagehandInitParams: UnmarshalJSON on nil pointer")
	}
	type plain StagehandInitParams
	var decoded plain
	if err := decodeStrictJSON(data, &decoded); err != nil {
		return err
	}
	if decoded.Browserbase != nil && decoded.Browser == nil {
		return errors.New("client Browserbase transport requires browser metadata")
	}
	*value = StagehandInitParams(decoded)
	return nil
}
