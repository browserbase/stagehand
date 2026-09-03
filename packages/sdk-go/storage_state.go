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
	Origin       string                         `json:"origin"`
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

// Pointer fields force presence checks so missing httpOnly/secure/etc. reject
// instead of silently defaulting to false/zero.
type storageStateCookieJSON struct {
	Name     *string  `json:"name"`
	Value    *string  `json:"value"`
	Domain   *string  `json:"domain"`
	Path     *string  `json:"path"`
	Expires  *float64 `json:"expires"`
	HTTPOnly *bool    `json:"httpOnly"`
	Secure   *bool    `json:"secure"`
	SameSite *string  `json:"sameSite"`
}

type storageStateFile struct {
	Cookies []storageStateCookieJSON `json:"cookies"`
	Origins json.RawMessage          `json:"origins"`
}

type storageStateExportCookie struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	Expires  float64 `json:"expires"`
	HTTPOnly bool    `json:"httpOnly"`
	Secure   bool    `json:"secure"`
	SameSite string  `json:"sameSite"`
}

type storageStateExport struct {
	Cookies []storageStateExportCookie `json:"cookies"`
	Origins []StorageStateOrigin       `json:"origins"`
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

// prepareStorageStateCookies normalizes empty SameSite to Lax and rejects invalid values.
func prepareStorageStateCookies(cookies []Cookie) ([]Cookie, error) {
	if cookies == nil {
		return nil, nil
	}
	out := make([]Cookie, len(cookies))
	copy(out, cookies)
	for index := range out {
		// CDP may omit SameSite; Playwright-compatible storage state uses Lax.
		if out[index].SameSite == "" {
			out[index].SameSite = CookieSameSiteLax
		}
		switch out[index].SameSite {
		case CookieSameSiteStrict, CookieSameSiteLax, CookieSameSiteNone:
		default:
			return nil, fmt.Errorf("storage state cookies[%d] has an invalid sameSite", index)
		}
	}
	return out, nil
}

func writeStorageStateFile(path string, state StorageState) error {
	cookies, err := prepareStorageStateCookies(state.Cookies)
	if err != nil {
		return err
	}
	payload := storageStateExport{
		Cookies: make([]storageStateExportCookie, len(cookies)),
		Origins: []StorageStateOrigin{},
	}
	for index, cookie := range cookies {
		payload.Cookies[index] = storageStateExportCookie{
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
		cookie, err := cookieFromStorageStateJSON(entry, index)
		if err != nil {
			return StorageState{}, err
		}
		cookies[index] = cookie
	}
	// origins / localStorage are ignored until supported; keep the Playwright shape.
	return StorageState{Cookies: cookies, Origins: []StorageStateOrigin{}}, nil
}

func cookieFromStorageStateJSON(entry storageStateCookieJSON, index int) (Cookie, error) {
	if entry.Name == nil || entry.Value == nil || entry.Domain == nil || entry.Path == nil ||
		entry.Expires == nil || entry.HTTPOnly == nil || entry.Secure == nil || entry.SameSite == nil {
		return Cookie{}, fmt.Errorf("storage state cookies[%d] has an invalid shape", index)
	}
	sameSite := CookieSameSite(*entry.SameSite)
	if sameSite == "" {
		sameSite = CookieSameSiteLax
	}
	switch sameSite {
	case CookieSameSiteStrict, CookieSameSiteLax, CookieSameSiteNone:
	default:
		return Cookie{}, fmt.Errorf("storage state cookies[%d] has an invalid sameSite", index)
	}
	return Cookie{
		Name:     *entry.Name,
		Value:    *entry.Value,
		Domain:   *entry.Domain,
		Path:     *entry.Path,
		Expires:  *entry.Expires,
		HTTPOnly: *entry.HTTPOnly,
		Secure:   *entry.Secure,
		SameSite: sameSite,
	}, nil
}
