package config

import (
	"strings"
	"testing"
)

// good production config — should pass validation.
func validProdConfig() Config {
	return Config{
		AppEnv:        "production",
		JWTSecret:     strings.Repeat("a", 32),
		CaddyAskSecret: "real-non-default-secret-1234",
		PlatformIPs:   []string{"203.0.113.10"},
		DatabaseURL:   "postgres://u:p@db:5432/x?sslmode=require",
		CORSOrigins:   []string{"https://app.example.com"},
		PublicAppHost: "app.example.com",
		PublicAPIHost: "api.example.com",
		AppBaseURL:    "https://app.example.com",
		StorageDriver: "local",
		AdminPassword: "supersecret-1234567",
		MailDriver:    "log",
	}
}

func TestValidate_DevAlwaysPasses(t *testing.T) {
	c := Config{AppEnv: "development"} // everything else empty/default
	if err := c.Validate(); err != nil {
		t.Fatalf("dev should bypass: %v", err)
	}
}

func TestValidate_ProdAccepts(t *testing.T) {
	if err := validProdConfig().Validate(); err != nil {
		t.Fatalf("valid prod config rejected: %v", err)
	}
}

func TestValidate_RejectsDefaultJWT(t *testing.T) {
	c := validProdConfig()
	c.JWTSecret = "change-me-in-production-please"
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("expected JWT_SECRET error, got %v", err)
	}
}

func TestValidate_RejectsShortJWT(t *testing.T) {
	c := validProdConfig()
	c.JWTSecret = "shorty"
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "too short") {
		t.Fatalf("expected too-short error, got %v", err)
	}
}

func TestValidate_RejectsSslmodeDisable(t *testing.T) {
	c := validProdConfig()
	c.DatabaseURL = "postgres://u:p@db:5432/x?sslmode=disable"
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "sslmode=disable") {
		t.Fatalf("expected sslmode=disable error, got %v", err)
	}
}

func TestValidate_RejectsLocalhostCORS(t *testing.T) {
	c := validProdConfig()
	c.CORSOrigins = []string{"http://localhost:3000"}
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "CORS_ORIGINS") {
		t.Fatalf("expected CORS_ORIGINS error, got %v", err)
	}
}

func TestValidate_RejectsLocalhostPublicHost(t *testing.T) {
	c := validProdConfig()
	c.PublicAppHost = "app.localhost"
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "PUBLIC_APP_HOST") {
		t.Fatalf("expected PUBLIC_APP_HOST error, got %v", err)
	}
}

func TestValidate_RejectsMissingPlatformIPs(t *testing.T) {
	c := validProdConfig()
	c.PlatformIPs = nil
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "PLATFORM_IPS") {
		t.Fatalf("expected PLATFORM_IPS error, got %v", err)
	}
}

func TestValidate_RejectsDefaultMinioInS3Mode(t *testing.T) {
	c := validProdConfig()
	c.StorageDriver = "s3"
	c.StorageS3SecretKey = "minioadmin"
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "STORAGE_S3_SECRET_KEY") {
		t.Fatalf("expected S3 secret error, got %v", err)
	}
}

func TestValidate_RejectsSmtpWithoutHost(t *testing.T) {
	c := validProdConfig()
	c.MailDriver = "smtp"
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "SMTP_HOST") {
		t.Fatalf("expected SMTP_HOST error, got %v", err)
	}
}

func TestValidate_RejectsLocalAppAndOAuthURLs(t *testing.T) {
	c := validProdConfig()
	c.AppBaseURL = "http://localhost:4000"
	c.GoogleOAuthClientID = "id.apps.googleusercontent.com"
	c.GoogleOAuthRedirectURL = "http://localhost:4011/api/v1/auth/google/callback"
	err := c.Validate()
	if err == nil {
		t.Fatal("expected localhost APP_BASE_URL / GOOGLE_OAUTH_REDIRECT_URL to be rejected")
	}
	for _, want := range []string{"APP_BASE_URL", "GOOGLE_OAUTH_REDIRECT_URL"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %s", err, want)
		}
	}

	c = validProdConfig() // Google OAuth disabled: redirect URL not required
	if err := c.Validate(); err != nil {
		t.Fatalf("prod config without Google OAuth rejected: %v", err)
	}
}

// The e.id callback must match the URL registered at e.id byte for byte.
func TestEIDCallbackURL(t *testing.T) {
	cases := []struct{ app, host, want string }{
		{"https://umkm.pandi.id", "api.umkm.pandi.id", "https://api.umkm.pandi.id/api/v1/auth/eid/callback"},
		{"http://app.localhost", "api.localhost", "http://api.localhost/api/v1/auth/eid/callback"},
	}
	for _, tc := range cases {
		c := Config{AppBaseURL: tc.app, PublicAPIHost: tc.host}
		if got := c.EIDCallbackURL(); got != tc.want {
			t.Errorf("EIDCallbackURL(%q, %q) = %q, want %q", tc.app, tc.host, got, tc.want)
		}
	}
}
