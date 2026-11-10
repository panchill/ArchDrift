package architecture

import (
	"encoding/json"
	"time"
)

type Snapshot struct {
	Version   int64           `json:"version"`
	UpdatedAt time.Time       `json:"updatedAt"`
	Model     json.RawMessage `json:"model"`
}
