"""goose, which speaks ACP itself: `goose acp` ("Run goose as an ACP agent server on
stdio", goose 1.57.0). It runs on the user's own goose setup: their provider, model and
extensions. Its session modes are `auto` ("Automatically approve tool calls"), `approve`,
`smart_approve` and `chat`; Bomby sets `auto`, so permissions are bypassed. It has no
steering, so a request sent mid-task waits for the running turn. Its models depend on its
`provider` setting, which it lists without a category, so it's named to be pickable.

Its keys: goose advertises no ACP `env_var` auth method, only "Configure Provider"
(`goose configure`), so the variables each provider reads are named here, by provider id
(goose 1.59.0: `ConfigKey`s in `crates/goose/src/providers/`, `api_key_env` in
`crates/goose-providers/src/declarative/definitions/`; docs/acp-notes.md#goose-keys).
Providers that sign in another way (OAuth, a cloud's credentials, a local server) have none.

Its provider, outside a session, is where goose itself looks (`get_active_provider`,
`crates/goose/src/config/providers.rs`, 1.59.0): `GOOSE_PROVIDER` or `ACTIVE_PROVIDER` in its
environment (`get_param` upper-cases the key), then `active_provider` (or, before goose moved
it, `GOOSE_PROVIDER`) in its config files, the system's first, the user's over it
(`Config::default`, `config/base.rs`). Config files named in `GOOSE_ADDITIONAL_CONFIG_FILES`
or under `GOOSE_PATH_ROOT` aren't read here: with those, a first check that times out names
no key.
"""

from .harness import Harness, KeyVar, KeyVars, SettingSource

# goose's config files, in the order it merges them, the user's last.
_CONFIG = "~/.config/goose/config.yaml"
_CONFIG_FILES = ("/etc/goose/config.yaml", _CONFIG)


def _key(name: str, provider: str) -> tuple[KeyVar, ...]:
    return (KeyVar(name, f"{provider} API key"),)


# The providers that take one API key, by goose's provider id.
_KEYS = KeyVars(
    setting="provider",
    # "Goose (Default)": the provider in goose's config (`DEFAULT_PROVIDER_ID`,
    # `acp/server.rs`, 1.59.0).
    defaults=frozenset({"goose"}),
    saved_in=SettingSource(
        env=("GOOSE_PROVIDER", "ACTIVE_PROVIDER"),
        files=_CONFIG_FILES,
        keys=("active_provider", "GOOSE_PROVIDER"),
    ),
    by_value={
        "anthropic": _key("ANTHROPIC_API_KEY", "Anthropic"),
        "openai": _key("OPENAI_API_KEY", "OpenAI"),
        "openrouter": _key("OPENROUTER_API_KEY", "OpenRouter"),
        "google": _key("GOOGLE_API_KEY", "Google"),
        "xai": _key("XAI_API_KEY", "xAI"),
        "tetrate": _key("TETRATE_API_KEY", "Tetrate"),
        "litellm": _key("LITELLM_API_KEY", "LiteLLM"),
        "groq": _key("GROQ_API_KEY", "Groq"),
        "custom_deepseek": _key("DEEPSEEK_API_KEY", "DeepSeek"),
        "mistral": _key("MISTRAL_API_KEY", "Mistral AI"),
        "venice": _key("VENICE_API_KEY", "Venice.ai"),
        "cerebras": _key("CEREBRAS_API_KEY", "Cerebras"),
        "together": _key("TOGETHER_API_KEY", "Together AI"),
        "fireworks-ai": _key("FIREWORKS_API_KEY", "Fireworks AI"),
        "perplexity": _key("PERPLEXITY_API_KEY", "Perplexity"),
        "moonshot": _key("MOONSHOT_API_KEY", "Moonshot"),
        "nvidia": _key("NVIDIA_API_KEY", "NVIDIA"),
        "novita": _key("NOVITA_API_KEY", "Novita AI"),
        "minimax": _key("MINIMAX_API_KEY", "MiniMax"),
        "alibaba": _key("DASHSCOPE_API_KEY", "Alibaba (Qwen)"),
        "nano-gpt": _key("NANOGPT_API_KEY", "NanoGPT"),
        "vercel_ai_gateway": _key("AI_GATEWAY_API_KEY", "Vercel AI Gateway"),
        "ollama_cloud": _key("OLLAMA_CLOUD_API_KEY", "Ollama Cloud"),
    },
)

GOOSE = Harness(
    id="goose",
    short_name="goose",
    program="goose",
    args=("acp",),
    bypass_mode="auto",
    pickable_settings=frozenset({"provider"}),
    key_vars=_KEYS,
    # With a key saved in Bomby, goose reads its secrets from the environment and its own
    # secrets.yaml, never its keychain item, which macOS asks about at every goose update
    # (goose ships ad-hoc signed). Checked in goose 1.59.0's source, docs/acp-notes.md.
    saved_keys_env={"GOOSE_DISABLE_KEYRING": "1"},
    setup_files=(_CONFIG,),
)
