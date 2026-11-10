package architecture

import "errors"

var (
	ErrNotConfigured = errors.New("architecture is not configured")
	ErrUnavailable   = errors.New("architecture storage is unavailable")
)

type Detail struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ValidationError struct {
	Details []Detail
}

func (*ValidationError) Error() string { return "invalid CALM architecture" }

type VersionConflict struct {
	CurrentVersion int64
}

func (*VersionConflict) Error() string { return "architecture version conflict" }
