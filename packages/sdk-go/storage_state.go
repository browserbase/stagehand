package stagehand

import (
	"encoding/json"
	"fmt"
	"os"
)

// StorageState is a Playwright-compatible cookie export. Origins is reserved for
// future localStorage support and is always empty on export today.
type StorageState struct {
	Cookies []Cookie             `json:"cookies"`
	Origins []StorageStateOrigin `json:"origins"`
}

// StorageStateOrigin holds origin-scoped storage. Unused on export today.
type StorageStateOrigin struct {
	Origin       string                       `json:"origin"`
	LocalStorage []StorageStateLocalStorageItem `json:"localStorage"`
}

// StorageStateLocalStorageItem is one localStorage entry for an origin.
type StorageStateLocalStorageItem struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// StorageStateOptions configures StorageState export.
type StorageStateOptions struct {
	// Path, when non-empty, also writes the storage state JSON to disk.
	Path string
}

type storageStateFile struct {
	Cookies []storageStateCookieJSON `json:"cookies"`
	Origins []StorageStateOrigin     `json:"origins"`
}

type storageStateCookieJSON struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	Expires  float64 `json:"expires"`
	HTTPOnly bool    `json:"httpOnly"`
	Secure   bool    `json:"secure"`
	SameSite string  `json:"sameSite"`
}

func cookieToParam(cookie Cookie) CookieParam {
	domain := cookie.Domain
	path := cookie.Path
	expires := cookie.Expires
	httpOnly := cookie.HTTPOnly
	secure := cookie.Secure
	sameSite := CookieParamSameSite(cookie.SameSite)
	return CookieParam{
		Name:     cookie.Name,
		Value:    cookie.Value,
		Domain:   &domain,
		Path:     &path,
		Expires:  &expires,
		HTTPOnly: &httpOnly,
		Secure:   &secure,
		SameSite: &sameSite,
	}
}

func writeStorageStateFile(path string, state StorageState) error {
	payload := storageStateFile{
		Cookies: make([]storageStateCookieJSON, len(state.Cookies)),
		Origins: state.Origins,
	}
	if payload.Origins == nil {
		payload.Origins = []StorageStateOrigin{}
	}
	for index, cookie := range state.Cookies {
		payload.Cookies[index] = storageStateCookieJSON{
			Name:     cookie.Name,
			Value:    cookie.Value,
			Domain:   cookie.Domain,
			Path:     cookie.Path,
			Expires:  cookie.Expires,
			HTTPOnly: cookie.HTTPOnly,
			Secure:   cookie.Secure,
			SameSite: string(cookie.SameSite),
		}
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func readStorageStateFile(path string) (StorageState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return StorageState{}, err
	}
	var payload storageStateFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return StorageState{}, fmt.Errorf("set storage state: parse %s: %w", path, err)
	}
	return normalizeStorageStateFile(payload)
}

func normalizeStorageStateFile(payload storageStateFile) (StorageState, error) {
	if payload.Cookies == nil {
		return StorageState{}, fmt.Errorf("storage state must include a cookies array")
	}
	cookies := make([]Cookie, len(payload.Cookies))
	for index, entry := range payload.Cookies {
		sameSite := CookieSameSite(entry.SameSite)
		switch sameSite {
		case CookieSameSiteStrict, CookieSameSiteLax, CookieSameSiteNone:
		default:
			return StorageState{}, fmt.Errorf("storage state cookies[%d] has an invalid sameSite", index)
		}
		cookies[index] = Cookie{
			Name:     entry.Name,
			Value:    entry.Value,
			Domain:   entry.Domain,
			Path:     entry.Path,
			Expires:  entry.Expires,
			HTTPOnly: entry.HTTPOnly,
			Secure:   entry.Secure,
			SameSite: sameSite,
		}
	}
	origins := payload.Origins
	if origins == nil {
		origins = []StorageStateOrigin{}
	}
	return StorageState{Cookies: cookies, Origins: origins}, nil
}
