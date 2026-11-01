// Package openapi — serve the OpenAPI 3.1 spec for the public + user API.
//
// Hand-maintained JSON (same approach as api-registry): generating from code
// would mean annotating ~190 handlers, and the generator deps are heavy for
// what this buys. openapi_test.go guards the trade-off by diffing the spec
// against the real route table, so a new route cannot land undocumented.
//
// Admin routes (/api/v1/admin/*) are deliberately out of scope — they serve
// one internal panel and churn with it.
package openapi

import _ "embed"

//go:embed spec.json
var Spec []byte
