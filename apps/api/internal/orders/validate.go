package orders

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/webbuilder/api/internal/sites"
)

const (
	StatusNew        = "new"
	StatusProcessing = "processing"
	StatusDone       = "done"
	StatusCancelled  = "cancelled"

	maxCartLines  = 50
	maxQty        = 99
	minNameLen    = 2
	maxNameLen    = 80
	maxAddressLen = 300
	maxNoteLen    = 500
)

// FormatOrderNo renders the buyer-facing number, e.g. 42 -> "#0042".
func FormatOrderNo(seq int) string { return fmt.Sprintf("#%04d", seq) }

// ValidStatus reports whether s is one of the four stored statuses.
func ValidStatus(s string) bool {
	switch s {
	case StatusNew, StatusProcessing, StatusDone, StatusCancelled:
		return true
	}
	return false
}

// transitions: done and cancelled are terminal; new may skip straight to done
// because small sellers often hand over goods in one step.
var transitions = map[string]map[string]bool{
	StatusNew:        {StatusProcessing: true, StatusCancelled: true, StatusDone: true},
	StatusProcessing: {StatusDone: true, StatusCancelled: true},
}

// CanTransition reports whether an order may move from -> to.
func CanTransition(from, to string) bool { return transitions[from][to] }

// StatusLabel is the Indonesian name used in user-facing messages.
func StatusLabel(s string) string {
	switch s {
	case StatusNew:
		return "Baru"
	case StatusProcessing:
		return "Diproses"
	case StatusDone:
		return "Selesai"
	case StatusCancelled:
		return "Dibatalkan"
	}
	return s
}

// TransitionMessage explains in Indonesian why from -> to was refused.
func TransitionMessage(from, to string) string {
	switch from {
	case StatusDone:
		return "Pesanan yang sudah selesai tidak bisa diubah lagi."
	case StatusCancelled:
		return "Pesanan yang sudah dibatalkan tidak bisa diubah lagi."
	}
	if from == to {
		return fmt.Sprintf("Status pesanan sudah %s.", StatusLabel(to))
	}
	return fmt.Sprintf("Status pesanan tidak bisa diubah dari %s ke %s.", StatusLabel(from), StatusLabel(to))
}

// CreateRequest is the public checkout body.
type CreateRequest struct {
	Items []struct {
		Slug string `json:"slug"`
		Qty  int    `json:"qty"`
	} `json:"items"`
	Customer struct {
		Name    string `json:"name"`
		Phone   string `json:"phone"`
		Address string `json:"address"`
	} `json:"customer"`
	Note string `json:"note"`
	HP   string `json:"_hp"`
}

// ValidationError carries the 400 code + Indonesian message. Returned as a
// value (not via the response writer) so callers never mistake a written
// response for success.
type ValidationError struct {
	Code    string
	Message string
}

func (e *ValidationError) Error() string { return e.Code + ": " + e.Message }

func vErr(code, msg string) *ValidationError { return &ValidationError{Code: code, Message: msg} }

// Validate normalises the request into a CreateInput: trims text, merges
// duplicate slugs (first-seen order kept) and normalises the phone.
func (req *CreateRequest) Validate() (CreateInput, *ValidationError) {
	var in CreateInput
	if len(req.Items) == 0 {
		return in, vErr("empty_cart", "Keranjang belanja masih kosong.")
	}
	if len(req.Items) > maxCartLines {
		return in, vErr("too_many_items", fmt.Sprintf("Maksimal %d jenis produk per pesanan.", maxCartLines))
	}
	pos := map[string]int{}
	for _, it := range req.Items {
		slug := strings.ToLower(strings.TrimSpace(it.Slug))
		if slug == "" {
			return in, vErr("invalid_item", "Ada produk di keranjang yang tidak valid.")
		}
		if it.Qty < 1 || it.Qty > maxQty {
			return in, vErr("invalid_qty", fmt.Sprintf("Jumlah tiap produk harus antara 1 dan %d.", maxQty))
		}
		if i, ok := pos[slug]; ok {
			in.Lines[i].Qty += it.Qty
			if in.Lines[i].Qty > maxQty {
				return in, vErr("invalid_qty", fmt.Sprintf("Jumlah tiap produk harus antara 1 dan %d.", maxQty))
			}
			continue
		}
		pos[slug] = len(in.Lines)
		in.Lines = append(in.Lines, Line{Slug: slug, Qty: it.Qty})
	}

	name := strings.TrimSpace(req.Customer.Name)
	if n := utf8.RuneCountInString(name); n < minNameLen || n > maxNameLen {
		return in, vErr("invalid_name", fmt.Sprintf("Nama wajib diisi (%d–%d karakter).", minNameLen, maxNameLen))
	}
	phone, ok := sites.NormalizePhone(req.Customer.Phone)
	if !ok {
		return in, vErr("invalid_phone", "Nomor HP/WhatsApp tidak valid. Contoh: 0812-3456-7890")
	}
	address := strings.TrimSpace(req.Customer.Address)
	if utf8.RuneCountInString(address) > maxAddressLen {
		return in, vErr("invalid_address", fmt.Sprintf("Alamat maksimal %d karakter.", maxAddressLen))
	}
	note := strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(note) > maxNoteLen {
		return in, vErr("invalid_note", fmt.Sprintf("Catatan maksimal %d karakter.", maxNoteLen))
	}
	in.CustomerName = name
	in.CustomerPhone = phone
	in.CustomerAddress = address
	in.Note = note
	return in, nil
}
