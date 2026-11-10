package architecture

import (
	"bytes"
	"embed"
	"fmt"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

const schemaURL = "https://calm.finos.org/release/1.2/meta/calm.json"

//go:embed schemas/*.json
var schemas embed.FS

type Validator struct {
	schema *jsonschema.Schema
}

// NewValidator compiles only bundled schemas. The loader cannot access the
// network or local files, and uploaded documents never reach the compiler.
func NewValidator() (*Validator, error) {
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	c.UseLoader(jsonschema.SchemeURLLoader{})
	for _, name := range []string{"core", "interface", "control", "flow"} {
		raw, err := schemas.ReadFile("schemas/" + name + ".json")
		if err != nil {
			return nil, fmt.Errorf("read CALM schema %q: %w", name, err)
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			return nil, fmt.Errorf("decode CALM schema %q: %w", name, err)
		}
		if err := c.AddResource("https://calm.finos.org/release/1.2/meta/"+name+".json", doc); err != nil {
			return nil, fmt.Errorf("register CALM schema %q: %w", name, err)
		}
	}
	schema, err := c.Compile("https://calm.finos.org/release/1.2/meta/core.json")
	if err != nil {
		return nil, fmt.Errorf("compile CALM schema: %w", err)
	}
	return &Validator{schema: schema}, nil
}

func schemaDetails(err *jsonschema.ValidationError) []Detail {
	if len(err.Causes) == 0 {
		return []Detail{{
			Field:   "/" + strings.Join(err.InstanceLocation, "/"),
			Message: err.Error(),
		}}
	}
	details := []Detail{}
	for _, cause := range err.Causes {
		details = append(details, schemaDetails(cause)...)
		if len(details) >= 100 {
			return details[:100]
		}
	}
	return details
}
