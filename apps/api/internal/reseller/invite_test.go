package reseller

import (
	"testing"

	"github.com/google/uuid"

	"github.com/webbuilder/api/internal/auth"
)

// Only plain clients may be promoted. The invite dialog and the submit path
// both read this, so they can never disagree about who is eligible.
func TestAgentInviteBlocker(t *testing.T) {
	me := uuid.New()
	other := uuid.New()
	cases := []struct {
		name    string
		user    *auth.User
		blocked bool
	}{
		{"client is eligible", &auth.User{Role: auth.RoleClient}, false},
		{"already my agent", &auth.User{Role: auth.RoleAgent, ParentResellerID: &me}, true},
		{"agent of another reseller", &auth.User{Role: auth.RoleAgent, ParentResellerID: &other}, true},
		{"agent with no parent", &auth.User{Role: auth.RoleAgent}, true},
		{"reseller cannot be demoted", &auth.User{Role: auth.RoleReseller}, true},
		{"admin cannot be demoted", &auth.User{Role: auth.RoleAdmin}, true},
		{"unknown role", &auth.User{Role: "sesuatu"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := agentInviteBlocker(tc.user, me)
			if (got != "") != tc.blocked {
				t.Errorf("blocker = %q (blocked=%v), want blocked=%v", got, got != "", tc.blocked)
			}
			if tc.blocked && got == "" {
				t.Error("blocked case must carry a reason for the UI")
			}
		})
	}
}
