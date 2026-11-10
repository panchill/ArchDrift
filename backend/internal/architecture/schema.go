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

// Compile only bundled vocabulary schemas. Uploaded documents never supply schemas
// to the compiler, and the loader cannot access either the network or local files.
var calmSchema = func() *jsonschema.Schema {
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	c.UseLoader(jsonschema.SchemeURLLoader{})
	for _, name := range []string{"core", "interface", "control", "flow"} {
		raw, err := schemas.ReadFile("schemas/" + name + ".json")
		if err != nil {
			panic(err)
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			panic(err)
		}
		if err := c.AddResource("https://calm.finos.org/release/1.2/meta/"+name+".json", doc); err != nil {
			panic(err)
		}
	}
	return c.MustCompile("https://calm.finos.org/release/1.2/meta/core.json")
}()

type Detail struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func schemaDetails(err *jsonschema.ValidationError) []Detail {
	if len(err.Causes) == 0 {
		return []Detail{{"/" + strings.Join(err.InstanceLocation, "/"), fmt.Sprint(err)}}
	}
	var details []Detail
	for _, cause := range err.Causes {
		details = append(details, schemaDetails(cause)...)
		if len(details) >= 100 {
			return details[:100]
		}
	}
	return details
}
