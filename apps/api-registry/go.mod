module github.com/webbuilder/api-registry

go 1.26

require (
	github.com/gofiber/fiber/v2 v2.52.5
	github.com/google/uuid v1.6.0
	github.com/joho/godotenv v1.5.1
	github.com/teknispandi/epp-pandi-client/v2 v2.0.3
	go.uber.org/zap v1.27.1
)

require (
	github.com/andybalholm/brotli v1.0.5 // indirect
	github.com/klauspost/compress v1.17.0 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/mattn/go-runewidth v0.0.15 // indirect
	github.com/philhofer/fwd v1.1.2 // indirect
	github.com/rivo/uniseg v0.2.0 // indirect
	github.com/tinylib/msgp v1.1.8 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasthttp v1.51.0 // indirect
	github.com/valyala/tcplisten v1.0.0 // indirect
	go.uber.org/multierr v1.10.0 // indirect
	golang.org/x/sys v0.37.0 // indirect
	golang.org/x/time v0.15.0 // indirect
)

// The library now lives at github.com/pandi-id/epp-pandi-client, but its go.mod
// still declares the teknispandi path; drop this replace and switch the imports
// once pandi-id tags a release that declares its own path.
replace github.com/teknispandi/epp-pandi-client/v2 => github.com/pandi-id/epp-pandi-client/v2 v2.0.3
