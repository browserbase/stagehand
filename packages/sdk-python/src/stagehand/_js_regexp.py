from __future__ import annotations

import unicodedata

_ALLOWED_FLAGS = frozenset("dgimsuvy")
_MODIFIER_FLAGS = frozenset("ims")
_SYNTAX_CHARS = frozenset(r"^$\.*+?()[]{}|")
_IDENTITY_ESCAPES_U = _SYNTAX_CHARS | {"/"}
_CLASS_IDENTITY_ESCAPES_U = _IDENTITY_ESCAPES_U | {"-"}
_V_CLASS_SYNTAX_CHARS = frozenset(r"()[]{}/-\|")
_V_RESERVED_DOUBLE_PUNCTUATORS = frozenset({
    "&&",
    "!!",
    "##",
    "$$",
    "%%",
    "**",
    "++",
    ",,",
    "..",
    "::",
    ";;",
    "<<",
    "==",
    ">>",
    "??",
    "@@",
    "^^",
    "``",
    "~~",
})
_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")
_ASCII_LETTERS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
_DECIMAL_DIGITS = frozenset("0123456789")

_BINARY_PROPERTIES = frozenset({
    "ASCII",
    "ASCII_Hex_Digit",
    "AHex",
    "Alphabetic",
    "Alpha",
    "Any",
    "Assigned",
    "Bidi_Control",
    "Bidi_C",
    "Bidi_Mirrored",
    "Bidi_M",
    "Case_Ignorable",
    "CI",
    "Cased",
    "Changes_When_Casefolded",
    "CWCF",
    "Changes_When_Casemapped",
    "CWCM",
    "Changes_When_Lowercased",
    "CWL",
    "Changes_When_NFKC_Casefolded",
    "CWKCF",
    "Changes_When_Titlecased",
    "CWT",
    "Changes_When_Uppercased",
    "CWU",
    "Dash",
    "Default_Ignorable_Code_Point",
    "DI",
    "Deprecated",
    "Dep",
    "Diacritic",
    "Dia",
    "Emoji",
    "Emoji_Component",
    "EComp",
    "Emoji_Modifier",
    "EMod",
    "Emoji_Modifier_Base",
    "EBase",
    "Emoji_Presentation",
    "EPres",
    "Extended_Pictographic",
    "ExtPict",
    "Extender",
    "Ext",
    "Grapheme_Base",
    "Gr_Base",
    "Grapheme_Extend",
    "Gr_Ext",
    "Hex_Digit",
    "Hex",
    "IDS_Binary_Operator",
    "IDSB",
    "IDS_Trinary_Operator",
    "IDST",
    "ID_Continue",
    "IDC",
    "ID_Start",
    "IDS",
    "Ideographic",
    "Ideo",
    "Join_Control",
    "Join_C",
    "Logical_Order_Exception",
    "LOE",
    "Lowercase",
    "Lower",
    "Math",
    "Noncharacter_Code_Point",
    "NChar",
    "Pattern_Syntax",
    "Pat_Syn",
    "Pattern_White_Space",
    "Pat_WS",
    "Quotation_Mark",
    "QMark",
    "Radical",
    "Regional_Indicator",
    "RI",
    "Sentence_Terminal",
    "STerm",
    "Soft_Dotted",
    "SD",
    "Terminal_Punctuation",
    "Term",
    "Unified_Ideograph",
    "UIdeo",
    "Uppercase",
    "Upper",
    "Variation_Selector",
    "VS",
    "White_Space",
    "space",
    "XID_Continue",
    "XIDC",
    "XID_Start",
    "XIDS",
})

_STRING_PROPERTIES = frozenset({
    "Basic_Emoji",
    "Emoji_Keycap_Sequence",
    "RGI_Emoji_Modifier_Sequence",
    "RGI_Emoji_Flag_Sequence",
    "RGI_Emoji_Tag_Sequence",
    "RGI_Emoji_ZWJ_Sequence",
    "RGI_Emoji",
})

_GENERAL_CATEGORIES = frozenset({
    "C",
    "Other",
    "Cc",
    "Control",
    "cntrl",
    "Cf",
    "Format",
    "Cn",
    "Unassigned",
    "Co",
    "Private_Use",
    "Cs",
    "Surrogate",
    "L",
    "Letter",
    "LC",
    "Cased_Letter",
    "Ll",
    "Lowercase_Letter",
    "Lm",
    "Modifier_Letter",
    "Lo",
    "Other_Letter",
    "Lt",
    "Titlecase_Letter",
    "Lu",
    "Uppercase_Letter",
    "M",
    "Mark",
    "Combining_Mark",
    "Mc",
    "Spacing_Mark",
    "Me",
    "Enclosing_Mark",
    "Mn",
    "Nonspacing_Mark",
    "N",
    "Number",
    "Nd",
    "Decimal_Number",
    "digit",
    "Nl",
    "Letter_Number",
    "No",
    "Other_Number",
    "P",
    "Punctuation",
    "punct",
    "Pc",
    "Connector_Punctuation",
    "Pd",
    "Dash_Punctuation",
    "Pe",
    "Close_Punctuation",
    "Pf",
    "Final_Punctuation",
    "Pi",
    "Initial_Punctuation",
    "Po",
    "Other_Punctuation",
    "Ps",
    "Open_Punctuation",
    "S",
    "Symbol",
    "Sc",
    "Currency_Symbol",
    "Sk",
    "Modifier_Symbol",
    "Sm",
    "Math_Symbol",
    "So",
    "Other_Symbol",
    "Z",
    "Separator",
    "Zl",
    "Line_Separator",
    "Zp",
    "Paragraph_Separator",
    "Zs",
    "Space_Separator",
})

_SCRIPT_NAMES = frozenset({
    "Adlam",
    "Adlm",
    "Ahom",
    "Anatolian_Hieroglyphs",
    "Hluw",
    "Arabic",
    "Arab",
    "Armenian",
    "Armn",
    "Avestan",
    "Avst",
    "Balinese",
    "Bali",
    "Bamum",
    "Bamu",
    "Bassa_Vah",
    "Bass",
    "Batak",
    "Batk",
    "Bengali",
    "Beng",
    "Bhaiksuki",
    "Bhks",
    "Bopomofo",
    "Bopo",
    "Brahmi",
    "Brah",
    "Braille",
    "Brai",
    "Buginese",
    "Bugi",
    "Buhid",
    "Buhd",
    "Canadian_Aboriginal",
    "Cans",
    "Carian",
    "Cari",
    "Caucasian_Albanian",
    "Aghb",
    "Chakma",
    "Cakm",
    "Cham",
    "Cherokee",
    "Cher",
    "Chorasmian",
    "Chrs",
    "Common",
    "Zyyy",
    "Coptic",
    "Copt",
    "Qaac",
    "Cuneiform",
    "Xsux",
    "Cypriot",
    "Cprt",
    "Cypro_Minoan",
    "Cpmn",
    "Cyrillic",
    "Cyrl",
    "Deseret",
    "Dsrt",
    "Devanagari",
    "Deva",
    "Dives_Akuru",
    "Diak",
    "Dogra",
    "Dogr",
    "Duployan",
    "Dupl",
    "Egyptian_Hieroglyphs",
    "Egyp",
    "Elbasan",
    "Elba",
    "Elymaic",
    "Elym",
    "Ethiopic",
    "Ethi",
    "Garay",
    "Gara",
    "Georgian",
    "Geor",
    "Glagolitic",
    "Glag",
    "Gothic",
    "Goth",
    "Grantha",
    "Gran",
    "Greek",
    "Grek",
    "Gujarati",
    "Gujr",
    "Gunjala_Gondi",
    "Gong",
    "Gurmukhi",
    "Guru",
    "Gurung_Khema",
    "Gukh",
    "Han",
    "Hani",
    "Hangul",
    "Hang",
    "Hanifi_Rohingya",
    "Rohg",
    "Hanunoo",
    "Hano",
    "Hatran",
    "Hatr",
    "Hebrew",
    "Hebr",
    "Hiragana",
    "Hira",
    "Imperial_Aramaic",
    "Armi",
    "Inherited",
    "Zinh",
    "Qaai",
    "Inscriptional_Pahlavi",
    "Phli",
    "Inscriptional_Parthian",
    "Prti",
    "Javanese",
    "Java",
    "Kaithi",
    "Kthi",
    "Kannada",
    "Knda",
    "Katakana",
    "Kana",
    "Kawi",
    "Kayah_Li",
    "Kali",
    "Kharoshthi",
    "Khar",
    "Khitan_Small_Script",
    "Kits",
    "Khmer",
    "Khmr",
    "Khojki",
    "Khoj",
    "Khudawadi",
    "Sind",
    "Kirat_Rai",
    "Krai",
    "Lao",
    "Laoo",
    "Latin",
    "Latn",
    "Lepcha",
    "Lepc",
    "Limbu",
    "Limb",
    "Linear_A",
    "Lina",
    "Linear_B",
    "Linb",
    "Lisu",
    "Lycian",
    "Lyci",
    "Lydian",
    "Lydi",
    "Mahajani",
    "Mahj",
    "Makasar",
    "Maka",
    "Malayalam",
    "Mlym",
    "Mandaic",
    "Mand",
    "Manichaean",
    "Mani",
    "Marchen",
    "Marc",
    "Masaram_Gondi",
    "Gonm",
    "Medefaidrin",
    "Medf",
    "Meetei_Mayek",
    "Mtei",
    "Mende_Kikakui",
    "Mend",
    "Meroitic_Cursive",
    "Merc",
    "Meroitic_Hieroglyphs",
    "Mero",
    "Miao",
    "Plrd",
    "Modi",
    "Mongolian",
    "Mong",
    "Mro",
    "Mroo",
    "Multani",
    "Mult",
    "Myanmar",
    "Mymr",
    "Nabataean",
    "Nbat",
    "Nag_Mundari",
    "Nagm",
    "Nandinagari",
    "Nand",
    "New_Tai_Lue",
    "Talu",
    "Newa",
    "Nko",
    "Nkoo",
    "Nushu",
    "Nshu",
    "Nyiakeng_Puachue_Hmong",
    "Hmnp",
    "Ogham",
    "Ogam",
    "Ol_Chiki",
    "Olck",
    "Ol_Onal",
    "Onao",
    "Old_Hungarian",
    "Hung",
    "Old_Italic",
    "Ital",
    "Old_North_Arabian",
    "Narb",
    "Old_Permic",
    "Perm",
    "Old_Persian",
    "Xpeo",
    "Old_Sogdian",
    "Sogo",
    "Old_South_Arabian",
    "Sarb",
    "Old_Turkic",
    "Orkh",
    "Old_Uyghur",
    "Ougr",
    "Oriya",
    "Orya",
    "Osage",
    "Osge",
    "Osmanya",
    "Osma",
    "Pahawh_Hmong",
    "Hmng",
    "Palmyrene",
    "Palm",
    "Pau_Cin_Hau",
    "Pauc",
    "Phags_Pa",
    "Phag",
    "Phoenician",
    "Phnx",
    "Psalter_Pahlavi",
    "Phlp",
    "Rejang",
    "Rjng",
    "Runic",
    "Runr",
    "Samaritan",
    "Samr",
    "Saurashtra",
    "Saur",
    "Sharada",
    "Shrd",
    "Shavian",
    "Shaw",
    "Siddham",
    "Sidd",
    "SignWriting",
    "Sgnw",
    "Sinhala",
    "Sinh",
    "Sogdian",
    "Sogd",
    "Sora_Sompeng",
    "Sora",
    "Soyombo",
    "Soyo",
    "Sundanese",
    "Sund",
    "Sunuwar",
    "Sunu",
    "Syloti_Nagri",
    "Sylo",
    "Syriac",
    "Syrc",
    "Tagalog",
    "Tglg",
    "Tagbanwa",
    "Tagb",
    "Tai_Le",
    "Tale",
    "Tai_Tham",
    "Lana",
    "Tai_Viet",
    "Tavt",
    "Takri",
    "Takr",
    "Tamil",
    "Taml",
    "Tangsa",
    "Tnsa",
    "Tangut",
    "Tang",
    "Telugu",
    "Telu",
    "Thaana",
    "Thaa",
    "Thai",
    "Tibetan",
    "Tibt",
    "Tifinagh",
    "Tfng",
    "Tirhuta",
    "Tirh",
    "Todhri",
    "Todr",
    "Toto",
    "Tulu_Tigalari",
    "Tutg",
    "Ugaritic",
    "Ugar",
    "Unknown",
    "Vai",
    "Vaii",
    "Vithkuqi",
    "Vith",
    "Wancho",
    "Wcho",
    "Warang_Citi",
    "Wara",
    "Yezidi",
    "Yezi",
    "Yi",
    "Yiii",
    "Zanabazar_Square",
    "Zanb",
    "Zzzz",
})

_INVALID_MESSAGE = "Invalid cookie filter regular expression"


def validate_js_regexp(source: str, flags: str | None = None) -> None:
    if flags is not None:
        seen: set[str] = set()
        for flag in flags:
            if flag not in _ALLOWED_FLAGS or flag in seen:
                raise ValueError(_INVALID_MESSAGE)
            seen.add(flag)
        if "u" in seen and "v" in seen:
            raise ValueError(_INVALID_MESSAGE)
    unicode_mode = flags is not None and "u" in flags
    unicode_sets = flags is not None and "v" in flags
    parser = _JSRegExpParser(source, unicode_mode=unicode_mode, unicode_sets=unicode_sets)
    parser.parse()


_ID_START_CATEGORIES = frozenset({"Lu", "Ll", "Lt", "Lm", "Lo", "Nl"})
_ID_CONTINUE_CATEGORIES = _ID_START_CATEGORIES | frozenset({"Mn", "Mc", "Nd", "Pc"})
_OTHER_ID_START = frozenset({0x1885, 0x1886, 0x2118, 0x212E, 0x309B, 0x309C})
_OTHER_ID_CONTINUE = frozenset({
    0x00B7,
    0x0387,
    *range(0x1369, 0x1372),
    0x19DA,
    0x30FB,
    0xFF65,
})
_ID_PATTERN_SYNTAX_EXCLUSIONS = frozenset({0x2E2F})


def _is_id_start(cp: int) -> bool:
    if cp in (0x24, 0x5F):
        return True
    if cp in _ID_PATTERN_SYNTAX_EXCLUSIONS:
        return False
    if cp in _OTHER_ID_START:
        return True
    return unicodedata.category(chr(cp)) in _ID_START_CATEGORIES


def _is_id_continue(cp: int) -> bool:
    if cp in (0x24, 0x5F, 0x200C, 0x200D):
        return True
    if cp in _ID_PATTERN_SYNTAX_EXCLUSIONS:
        return False
    if cp in _OTHER_ID_START or cp in _OTHER_ID_CONTINUE:
        return True
    return unicodedata.category(chr(cp)) in _ID_CONTINUE_CATEGORIES


class _JSRegExpParser:
    def __init__(self, source: str, *, unicode_mode: bool, unicode_sets: bool) -> None:
        self._source = source
        self._length = len(source)
        self._pos = 0
        self._u = unicode_mode
        self._v = unicode_sets
        self._u_or_v = unicode_mode or unicode_sets
        self._capturing_groups = 0
        self._defined_group_names: set[str] = set()
        self._decimal_backrefs: list[int] = []
        self._named_backrefs: list[str] = []
        self._invalid_k_if_named = False

    def parse(self) -> None:
        self._parse_disjunction()
        if self._pos != self._length:
            raise ValueError(_INVALID_MESSAGE)
        if self._u_or_v:
            for ref in self._decimal_backrefs:
                if ref > self._capturing_groups:
                    raise ValueError(_INVALID_MESSAGE)
        if self._u_or_v or self._defined_group_names:
            if self._invalid_k_if_named:
                raise ValueError(_INVALID_MESSAGE)
            for name in self._named_backrefs:
                if name not in self._defined_group_names:
                    raise ValueError(_INVALID_MESSAGE)

    def _peek(self, offset: int = 0) -> str | None:
        idx = self._pos + offset
        return self._source[idx] if idx < self._length else None

    def _parse_disjunction(self) -> set[str]:
        all_names = self._parse_alternative()
        while self._peek() == "|":
            self._pos += 1
            all_names |= self._parse_alternative()
        return all_names

    def _parse_alternative(self) -> set[str]:
        names: set[str] = set()
        while self._pos < self._length:
            ch = self._source[self._pos]
            if ch in (")", "|"):
                break
            term_names, quantifiable = self._parse_term()
            if names & term_names:
                raise ValueError(_INVALID_MESSAGE)
            names |= term_names
            if quantifiable:
                self._try_parse_quantifier()
            elif self._starts_quantifier():
                raise ValueError(_INVALID_MESSAGE)
        return names

    def _parse_term(self) -> tuple[set[str], bool]:
        ch = self._source[self._pos]
        if ch in ("^", "$"):
            self._pos += 1
            return set(), False
        if ch in ("*", "+", "?"):
            raise ValueError(_INVALID_MESSAGE)
        if ch == "{":
            if self._try_parse_brace_quantifier() is not None:
                raise ValueError(_INVALID_MESSAGE)
            if self._u_or_v:
                raise ValueError(_INVALID_MESSAGE)
            self._pos += 1
            return set(), True
        if ch in ("}", "]"):
            if self._u_or_v:
                raise ValueError(_INVALID_MESSAGE)
            self._pos += 1
            return set(), True
        if ch == ".":
            self._pos += 1
            return set(), True
        if ch == "\\":
            return set(), self._parse_atom_escape()
        if ch == "[":
            self._parse_character_class()
            return set(), True
        if ch == "(":
            return self._parse_group()
        self._pos += 1
        return set(), True

    def _starts_quantifier(self) -> bool:
        ch = self._peek()
        if ch is None:
            return False
        if ch in ("*", "+", "?"):
            return True
        if ch == "{":
            saved = self._pos
            parsed = self._try_parse_brace_quantifier()
            self._pos = saved
            return parsed is not None
        return False

    def _try_parse_quantifier(self) -> bool:
        ch = self._peek()
        if ch is None:
            return False
        if ch in ("*", "+", "?"):
            self._pos += 1
            if self._peek() == "?":
                self._pos += 1
            return True
        if ch == "{":
            bounds = self._try_parse_brace_quantifier()
            if bounds is None:
                return False
            low, high = bounds
            if high is not None and low > high:
                raise ValueError(_INVALID_MESSAGE)
            if self._peek() == "?":
                self._pos += 1
            return True
        return False

    def _try_parse_brace_quantifier(self) -> tuple[int, int | None] | None:
        if self._peek() != "{":
            return None
        idx = self._pos + 1
        start_low = idx
        while idx < self._length and self._source[idx] in _DECIMAL_DIGITS:
            idx += 1
        if idx == start_low or idx >= self._length:
            return None
        low = int(self._source[start_low:idx])
        if self._source[idx] == "}":
            self._pos = idx + 1
            return low, low
        if self._source[idx] != ",":
            return None
        idx += 1
        if idx >= self._length:
            return None
        if self._source[idx] == "}":
            self._pos = idx + 1
            return low, None
        start_high = idx
        while idx < self._length and self._source[idx] in _DECIMAL_DIGITS:
            idx += 1
        if idx == start_high or idx >= self._length or self._source[idx] != "}":
            return None
        high = int(self._source[start_high:idx])
        self._pos = idx + 1
        return low, high

    def _parse_group(self) -> tuple[set[str], bool]:
        self._pos += 1
        quantifiable = True
        group_name: str | None = None
        if self._peek() == "?":
            self._pos += 1
            nxt = self._peek()
            if nxt is None:
                raise ValueError(_INVALID_MESSAGE)
            if nxt == ":":
                self._pos += 1
            elif nxt in ("=", "!"):
                self._pos += 1
                quantifiable = not self._u_or_v
            elif nxt == "<":
                self._pos += 1
                look = self._peek()
                if look in ("=", "!"):
                    self._pos += 1
                    quantifiable = False
                else:
                    group_name = self._parse_group_name()
                    self._capturing_groups += 1
                    self._defined_group_names.add(group_name)
            elif nxt in _MODIFIER_FLAGS or nxt == "-":
                self._parse_modifier_header()
            else:
                raise ValueError(_INVALID_MESSAGE)
        else:
            self._capturing_groups += 1

        inner_names = self._parse_disjunction()
        if self._peek() != ")":
            raise ValueError(_INVALID_MESSAGE)
        self._pos += 1
        if group_name is not None:
            if group_name in inner_names:
                raise ValueError(_INVALID_MESSAGE)
            inner_names = inner_names | {group_name}
        return inner_names, quantifiable

    def _parse_modifier_header(self) -> None:
        seen: set[str] = set()
        saw_dash = False
        while self._pos < self._length:
            ch = self._source[self._pos]
            if ch == ":":
                if not seen:
                    raise ValueError(_INVALID_MESSAGE)
                self._pos += 1
                return
            if ch == "-":
                if saw_dash:
                    raise ValueError(_INVALID_MESSAGE)
                saw_dash = True
                self._pos += 1
                continue
            if ch in _MODIFIER_FLAGS:
                if ch in seen:
                    raise ValueError(_INVALID_MESSAGE)
                seen.add(ch)
                self._pos += 1
                continue
            raise ValueError(_INVALID_MESSAGE)
        raise ValueError(_INVALID_MESSAGE)

    def _parse_group_name(self) -> str:
        chars: list[str] = []
        first = True
        while self._pos < self._length:
            ch = self._source[self._pos]
            if ch == ">":
                if not chars:
                    raise ValueError(_INVALID_MESSAGE)
                self._pos += 1
                return "".join(chars)
            if ch == "\\":
                self._pos += 1
                if self._peek() != "u":
                    raise ValueError(_INVALID_MESSAGE)
                self._pos += 1
                cp = self._parse_unicode_escape_code_point(allow_braced=True)
            else:
                cp = ord(ch)
                self._pos += 1
            if first:
                if not _is_id_start(cp):
                    raise ValueError(_INVALID_MESSAGE)
                first = False
            elif not _is_id_continue(cp):
                raise ValueError(_INVALID_MESSAGE)
            chars.append(chr(cp))
        raise ValueError(_INVALID_MESSAGE)

    def _parse_unicode_escape_code_point(self, *, allow_braced: bool) -> int:
        if allow_braced and self._peek() == "{":
            self._pos += 1
            start = self._pos
            while self._pos < self._length and self._source[self._pos] in _HEX_DIGITS:
                self._pos += 1
            if self._pos == start or self._peek() != "}":
                raise ValueError(_INVALID_MESSAGE)
            value = int(self._source[start : self._pos], 16)
            self._pos += 1
            if value > 0x10FFFF:
                raise ValueError(_INVALID_MESSAGE)
            return value
        if self._pos + 4 > self._length:
            raise ValueError(_INVALID_MESSAGE)
        chunk = self._source[self._pos : self._pos + 4]
        if any(c not in _HEX_DIGITS for c in chunk):
            raise ValueError(_INVALID_MESSAGE)
        self._pos += 4
        value = int(chunk, 16)
        if 0xD800 <= value <= 0xDBFF and self._source[self._pos : self._pos + 2] == "\\u":
            saved = self._pos
            self._pos += 2
            if self._pos + 4 <= self._length:
                trail = self._source[self._pos : self._pos + 4]
                if all(c in _HEX_DIGITS for c in trail):
                    low = int(trail, 16)
                    if 0xDC00 <= low <= 0xDFFF:
                        self._pos += 4
                        return 0x10000 + ((value - 0xD800) << 10) + (low - 0xDC00)
            self._pos = saved
        return value

    def _parse_atom_escape(self) -> bool:
        self._pos += 1
        ch = self._peek()
        if ch is None:
            raise ValueError(_INVALID_MESSAGE)
        if ch in ("b", "B"):
            self._pos += 1
            return False
        if ch in ("d", "D", "s", "S", "w", "W", "f", "n", "r", "t", "v"):
            self._pos += 1
            return True
        if ch == "0":
            self._pos += 1
            nxt = self._peek()
            if nxt is not None and nxt in _DECIMAL_DIGITS:
                if self._u_or_v:
                    raise ValueError(_INVALID_MESSAGE)
                self._consume_legacy_octal()
            return True
        if ch in "123456789":
            start = self._pos
            while self._pos < self._length and self._source[self._pos] in _DECIMAL_DIGITS:
                self._pos += 1
            if self._u_or_v:
                self._decimal_backrefs.append(int(self._source[start : self._pos]))
            return True
        if ch == "c":
            self._pos += 1
            nxt = self._peek()
            if nxt is not None and nxt in _ASCII_LETTERS:
                self._pos += 1
                return True
            if self._u_or_v:
                raise ValueError(_INVALID_MESSAGE)
            return True
        if ch == "x":
            self._pos += 1
            if self._try_consume_hex(2) is None and self._u_or_v:
                raise ValueError(_INVALID_MESSAGE)
            return True
        if ch == "u":
            self._pos += 1
            if self._u_or_v:
                self._parse_unicode_escape_code_point(allow_braced=True)
            else:
                self._try_consume_hex(4)
            return True
        if ch in ("p", "P"):
            self._pos += 1
            if self._u_or_v:
                self._parse_unicode_property_escape(negated=(ch == "P"))
            return True
        if ch == "k":
            self._pos += 1
            if self._peek() == "<":
                self._pos += 1
                saved = self._pos
                try:
                    name = self._parse_group_name()
                except ValueError:
                    if self._u_or_v:
                        raise
                    self._pos = saved - 1
                    self._invalid_k_if_named = True
                else:
                    self._named_backrefs.append(name)
            elif self._u_or_v:
                raise ValueError(_INVALID_MESSAGE)
            else:
                self._invalid_k_if_named = True
            return True
        if self._u_or_v and ch not in _IDENTITY_ESCAPES_U:
            raise ValueError(_INVALID_MESSAGE)
        self._pos += 1
        return True

    def _consume_legacy_octal(self) -> None:
        digits = 0
        while digits < 2 and self._pos < self._length and self._source[self._pos] in "01234567":
            self._pos += 1
            digits += 1

    def _try_consume_hex(self, count: int) -> int | None:
        if self._pos + count > self._length:
            return None
        chunk = self._source[self._pos : self._pos + count]
        if any(c not in _HEX_DIGITS for c in chunk):
            return None
        self._pos += count
        return int(chunk, 16)

    def _parse_unicode_property_escape(self, *, negated: bool) -> bool:
        if self._peek() != "{":
            raise ValueError(_INVALID_MESSAGE)
        self._pos += 1
        start = self._pos
        while self._pos < self._length and self._source[self._pos] != "}":
            self._pos += 1
        if self._peek() != "}":
            raise ValueError(_INVALID_MESSAGE)
        expr = self._source[start : self._pos]
        self._pos += 1
        if not expr:
            raise ValueError(_INVALID_MESSAGE)
        if "=" in expr:
            prop_name, sep, prop_val = expr.partition("=")
            if not sep or "=" in prop_val or not prop_val:
                raise ValueError(_INVALID_MESSAGE)
            if prop_name in ("General_Category", "gc"):
                if prop_val not in _GENERAL_CATEGORIES:
                    raise ValueError(_INVALID_MESSAGE)
                return False
            if prop_name in ("Script", "sc", "Script_Extensions", "scx"):
                if prop_val not in _SCRIPT_NAMES:
                    raise ValueError(_INVALID_MESSAGE)
                return False
            raise ValueError(_INVALID_MESSAGE)
        if expr in _BINARY_PROPERTIES or expr in _GENERAL_CATEGORIES:
            return False
        if expr in _STRING_PROPERTIES:
            if not self._v or negated:
                raise ValueError(_INVALID_MESSAGE)
            return True
        raise ValueError(_INVALID_MESSAGE)

    def _parse_character_class(self) -> None:
        if self._v:
            self._parse_v_character_class()
            return
        self._pos += 1
        if self._peek() == "^":
            self._pos += 1
        while self._pos < self._length:
            if self._source[self._pos] == "]":
                self._pos += 1
                return
            first = self._parse_class_atom()
            if self._peek() == "-" and self._peek(1) not in (None, "]"):
                self._pos += 1
                second = self._parse_class_atom()
                if first is None or second is None:
                    if self._u:
                        raise ValueError(_INVALID_MESSAGE)
                elif first > second:
                    raise ValueError(_INVALID_MESSAGE)
        raise ValueError(_INVALID_MESSAGE)

    def _parse_class_atom(self) -> int | None:
        ch = self._source[self._pos]
        if ch != "\\":
            self._pos += 1
            return ord(ch)
        self._pos += 1
        esc = self._peek()
        if esc is None:
            raise ValueError(_INVALID_MESSAGE)
        if esc in ("d", "D", "s", "S", "w", "W"):
            self._pos += 1
            return None
        if esc == "b":
            self._pos += 1
            return 0x08
        if esc == "f":
            self._pos += 1
            return 0x0C
        if esc == "n":
            self._pos += 1
            return 0x0A
        if esc == "r":
            self._pos += 1
            return 0x0D
        if esc == "t":
            self._pos += 1
            return 0x09
        if esc == "v":
            self._pos += 1
            return 0x0B
        if esc == "0":
            self._pos += 1
            nxt = self._peek()
            if nxt is not None and nxt in _DECIMAL_DIGITS:
                if self._u:
                    raise ValueError(_INVALID_MESSAGE)
                val = 0
                for _ in range(2):
                    c = self._peek()
                    if c is not None and c in "01234567" and val * 8 + int(c) <= 0xFF:
                        val = val * 8 + int(c)
                        self._pos += 1
                    else:
                        break
                return val
            return 0
        if esc in "123456789":
            if self._u:
                raise ValueError(_INVALID_MESSAGE)
            if esc in "1234567":
                val = int(esc)
                self._pos += 1
                for _ in range(2):
                    c = self._peek()
                    if c is not None and c in "01234567" and val * 8 + int(c) <= 0xFF:
                        val = val * 8 + int(c)
                        self._pos += 1
                    else:
                        break
                return val
            self._pos += 1
            return ord(esc)
        if esc == "c":
            self._pos += 1
            nxt = self._peek()
            if nxt is not None and nxt in _ASCII_LETTERS:
                self._pos += 1
                return ord(nxt) % 32
            if not self._u and nxt is not None and (nxt in _DECIMAL_DIGITS or nxt == "_"):
                self._pos += 1
                return ord(nxt) % 32
            if self._u:
                raise ValueError(_INVALID_MESSAGE)
            return ord("\\")
        if esc == "x":
            self._pos += 1
            val = self._try_consume_hex(2)
            if val is not None:
                return val
            if self._u:
                raise ValueError(_INVALID_MESSAGE)
            return ord("x")
        if esc == "u":
            self._pos += 1
            if self._u:
                return self._parse_unicode_escape_code_point(allow_braced=True)
            val = self._try_consume_hex(4)
            return val if val is not None else ord("u")
        if esc in ("p", "P"):
            self._pos += 1
            if self._u:
                self._parse_unicode_property_escape(negated=(esc == "P"))
                return None
            return ord(esc)
        if self._u and esc not in _CLASS_IDENTITY_ESCAPES_U:
            raise ValueError(_INVALID_MESSAGE)
        self._pos += 1
        return ord(esc)

    def _parse_v_character_class(self) -> bool:
        self._pos += 1
        negated = False
        if self._peek() == "^":
            negated = True
            self._pos += 1
        if self._peek() == "]":
            self._pos += 1
            return False

        may_contain_strings = False
        first_was_range, first_strings = self._parse_v_operand_or_range()
        may_contain_strings = may_contain_strings or first_strings

        two = self._source[self._pos : self._pos + 2]
        if two in ("&&", "--"):
            if first_was_range:
                raise ValueError(_INVALID_MESSAGE)
            op = two
            while self._source[self._pos : self._pos + 2] == op:
                self._pos += 2
                if self._peek() in (None, "]"):
                    raise ValueError(_INVALID_MESSAGE)
                _, rhs_strings = self._parse_v_operand(allow_range=False)
                if op == "&&":
                    may_contain_strings = may_contain_strings and rhs_strings
            if self._peek() != "]":
                raise ValueError(_INVALID_MESSAGE)
            self._pos += 1
        else:
            while self._pos < self._length and self._source[self._pos] != "]":
                if self._source[self._pos : self._pos + 2] in ("&&", "--"):
                    raise ValueError(_INVALID_MESSAGE)
                _, item_strings = self._parse_v_operand_or_range()
                may_contain_strings = may_contain_strings or item_strings
            if self._peek() != "]":
                raise ValueError(_INVALID_MESSAGE)
            self._pos += 1

        if negated and may_contain_strings:
            raise ValueError(_INVALID_MESSAGE)
        return False if negated else may_contain_strings

    def _parse_v_operand_or_range(self) -> tuple[bool, bool]:
        cp, has_strings = self._parse_v_operand(allow_range=True)
        if (
            cp is not None
            and self._peek() == "-"
            and self._source[self._pos : self._pos + 2] != "--"
        ):
            self._pos += 1
            if self._peek() in (None, "]"):
                raise ValueError(_INVALID_MESSAGE)
            end_cp, _ = self._parse_v_operand(allow_range=False)
            if end_cp is None or cp > end_cp:
                raise ValueError(_INVALID_MESSAGE)
            return True, False
        return False, has_strings

    def _parse_v_operand(self, *, allow_range: bool) -> tuple[int | None, bool]:
        ch = self._peek()
        if ch is None or ch == "]":
            raise ValueError(_INVALID_MESSAGE)
        if ch == "[":
            return None, self._parse_v_character_class()
        if ch == "\\":
            return self._parse_v_escape()
        if ch in _V_CLASS_SYNTAX_CHARS:
            raise ValueError(_INVALID_MESSAGE)
        if self._source[self._pos : self._pos + 2] in _V_RESERVED_DOUBLE_PUNCTUATORS:
            raise ValueError(_INVALID_MESSAGE)
        self._pos += 1
        return ord(ch), False

    def _parse_v_escape(self) -> tuple[int | None, bool]:
        self._pos += 1
        esc = self._peek()
        if esc is None:
            raise ValueError(_INVALID_MESSAGE)
        if esc in ("d", "D", "s", "S", "w", "W"):
            self._pos += 1
            return None, False
        if esc in ("p", "P"):
            self._pos += 1
            has_strings = self._parse_unicode_property_escape(negated=(esc == "P"))
            return None, has_strings
        if esc == "q":
            self._pos += 1
            return None, self._parse_v_string_disjunction()
        if esc == "b":
            self._pos += 1
            return 0x08, False
        if esc == "f":
            self._pos += 1
            return 0x0C, False
        if esc == "n":
            self._pos += 1
            return 0x0A, False
        if esc == "r":
            self._pos += 1
            return 0x0D, False
        if esc == "t":
            self._pos += 1
            return 0x09, False
        if esc == "v":
            self._pos += 1
            return 0x0B, False
        if esc == "0":
            self._pos += 1
            nxt = self._peek()
            if nxt is not None and nxt in _DECIMAL_DIGITS:
                raise ValueError(_INVALID_MESSAGE)
            return 0, False
        if esc == "c":
            self._pos += 1
            nxt = self._peek()
            if nxt is None or nxt not in _ASCII_LETTERS:
                raise ValueError(_INVALID_MESSAGE)
            self._pos += 1
            return ord(nxt) % 32, False
        if esc == "x":
            self._pos += 1
            val = self._try_consume_hex(2)
            if val is None:
                raise ValueError(_INVALID_MESSAGE)
            return val, False
        if esc == "u":
            self._pos += 1
            return self._parse_unicode_escape_code_point(allow_braced=True), False
        if esc in _CLASS_IDENTITY_ESCAPES_U or esc in frozenset("&!#$%*+,.:;<=>?@^`~"):
            self._pos += 1
            return ord(esc), False
        raise ValueError(_INVALID_MESSAGE)

    def _parse_v_string_disjunction(self) -> bool:
        if self._peek() != "{":
            raise ValueError(_INVALID_MESSAGE)
        self._pos += 1
        has_multi_or_empty = False
        cur_len = 0
        while self._pos < self._length:
            ch = self._source[self._pos]
            if ch == "}":
                if cur_len != 1:
                    has_multi_or_empty = True
                self._pos += 1
                return has_multi_or_empty
            if ch == "|":
                if cur_len != 1:
                    has_multi_or_empty = True
                cur_len = 0
                self._pos += 1
                continue
            if ch == "\\":
                cp, _ = self._parse_v_escape()
                if cp is None:
                    raise ValueError(_INVALID_MESSAGE)
            elif ch in _V_CLASS_SYNTAX_CHARS:
                raise ValueError(_INVALID_MESSAGE)
            elif self._source[self._pos : self._pos + 2] in _V_RESERVED_DOUBLE_PUNCTUATORS:
                raise ValueError(_INVALID_MESSAGE)
            else:
                self._pos += 1
            cur_len += 1
        raise ValueError(_INVALID_MESSAGE)
