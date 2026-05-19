import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const ACCOUNT_ENV = "PI_CODEX_ACCOUNTS";
const BASE_PROVIDER = "openai-codex";
const BASE_URL = "https://chatgpt.com/backend-api";
const API = "openai-codex-responses";
const ADD_ACCOUNT = "+ Add ChatGPT/Codex account";
const CANCEL = "Cancel";

const AUTH_BASE_URL = "https://auth.openai.com";
const ACCOUNTS_API_URL = `${AUTH_BASE_URL}/api/accounts`;
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const DEVICE_TIMEOUT_MS = 15 * 60 * 1000;

type AccountConfig = { accounts?: string[] };
type DeviceCodeResponse = { device_auth_id: string; user_code?: string; usercode?: string; interval?: string | number };
type DevicePollResponse = { authorization_code: string; code_verifier: string; code_challenge?: string };
type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };
type OAuthCredentials = { access: string; refresh: string; expires: number; accountId?: string };
type OAuthLoginCallbacks = {
	onProgress?: (message: string) => void;
};
type AiCompat = {
	getModels: (provider: string) => CodexModel[];
	refreshToken: (credentials: OAuthCredentials) => Promise<OAuthCredentials>;
	getApiKey: (credentials: OAuthCredentials) => string;
};
type CodexModel = {
	id: string;
	name: string;
	api?: unknown;
	baseUrl?: unknown;
	reasoning?: unknown;
	thinkingLevelMap?: unknown;
	input?: unknown;
	cost?: unknown;
	contextWindow?: unknown;
	maxTokens?: unknown;
	compat?: unknown;
};
type ModelCatalogModule = {
	getModels?: (provider: string) => CodexModel[];
	getBundledModels?: (provider: string) => CodexModel[];
};
type OAuthModule = {
	openaiCodexOAuthProvider?: {
		refreshToken?: (credentials: OAuthCredentials) => Promise<OAuthCredentials>;
		getApiKey?: (credentials: OAuthCredentials) => string;
	};
	refreshOpenAICodexToken?: (refreshToken: string) => Promise<OAuthCredentials>;
};
type CodingAgentModule = {
	getAgentDir?: () => string;
};
type RuntimeModule = ModelCatalogModule | OAuthModule | CodingAgentModule;
type ExtensionAPI = {
	registerProvider: (provider: string, providerConfig: unknown) => void;
	registerCommand: (name: string, command: unknown) => void;
	setModel: (model: unknown) => Promise<boolean> | boolean;
	on: (event: "model_select", handler: (event: { model: { provider: string } }, ctx: ExtensionCommandContext) => void) => void;
};
type ExtensionCommandContext = {
	model?: { provider?: string; id: string };
	modelRegistry: {
		authStorage: {
			get: (provider: string) => unknown;
			login: (provider: string, callbacks: {
				onAuth: () => undefined;
				onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string> | string;
				onProgress: (message: string) => void;
			}) => Promise<void>;
		};
		find: (provider: string, modelId: string) => unknown;
		refresh: () => void;
	};
	ui: {
		input: (message: string, placeholder?: string) => Promise<string> | string;
		notify: (message: string, type: "error" | "info" | "success") => void;
		select: (message: string, labels: string[]) => Promise<string | undefined> | string | undefined;
		setStatus: (key: string, value: string) => void;
	};
};

async function importFirst<T extends RuntimeModule>(moduleNames: readonly string[]): Promise<T> {
	let lastError: unknown;
	for (const moduleName of moduleNames) {
		try {
			return (await import(moduleName)) as T;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`Unable to import ${moduleNames.join(" or ")}`);
}

async function loadAiCompat(): Promise<AiCompat> {
	const ai = await importFirst<ModelCatalogModule>(["@oh-my-pi/pi-ai", "@earendil-works/pi-ai"]);
	const oauth = await importFirst<OAuthModule>(["@oh-my-pi/pi-ai/oauth", "@earendil-works/pi-ai/oauth"]);

	const getModels = ai.getModels ?? ai.getBundledModels;
	if (typeof getModels !== "function") {
		throw new Error("No compatible model catalog export found in pi-ai");
	}

	const oauthProvider = oauth.openaiCodexOAuthProvider;
	const refreshOpenAICodexToken = oauth.refreshOpenAICodexToken;
	const refreshToken = oauthProvider?.refreshToken ?? (
		typeof refreshOpenAICodexToken === "function"
			? (credentials: OAuthCredentials) => refreshOpenAICodexToken(credentials.refresh)
			: undefined
	);
	const getApiKey = oauthProvider?.getApiKey ?? ((credentials: OAuthCredentials) => credentials.access);
	if (typeof refreshToken !== "function") {
		throw new Error("No compatible Codex OAuth refresh export found in pi-ai");
	}
	return {
		getModels,
		refreshToken,
		getApiKey,
	};
}

async function getAgentDir(): Promise<string> {
	try {
		const codingAgent = await importFirst<CodingAgentModule>(["@oh-my-pi/pi-coding-agent", "@earendil-works/pi-coding-agent"]);
		if (typeof codingAgent.getAgentDir === "function") {
			return codingAgent.getAgentDir();
		}
	} catch {
		// Fall back to the conventional agent directory when no runtime package is importable.
	}
	return join(homedir(), process.env.PI_CONFIG_DIR || ".pi", "agent");
}

export function normalizeAccountName(name: string): string {
	return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function providerFor(account: string): string {
	return `${BASE_PROVIDER}-${account}`;
}

export function accountForProvider(provider: string | undefined): string | undefined {
	if (!provider) return undefined;
	if (provider === BASE_PROVIDER) return "current";
	if (provider.startsWith(`${BASE_PROVIDER}-`)) return provider.slice(BASE_PROVIDER.length + 1);
	return undefined;
}

export function decodeJwtPayload(token: string): unknown | null {
	try {
		const payload = token.split(".")[1];
		if (!payload) return null;
		return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
	} catch {
		return null;
	}
}

function getAccountId(accessToken: string): string | undefined {
	const payload = decodeJwtPayload(accessToken) as Record<string, unknown> | null;
	const auth = payload?.["https://api.openai.com/auth"] as { chatgpt_account_id?: unknown } | undefined;
	return typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined;
}

async function requestDeviceCode(): Promise<{ verificationUrl: string; userCode: string; deviceAuthId: string; interval: number }> {
	const response = await fetch(`${ACCOUNTS_API_URL}/deviceauth/usercode`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: CLIENT_ID }),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Codex device-code request failed (${response.status}): ${text || response.statusText}`);
	}
	const json = (await response.json()) as DeviceCodeResponse;
	const userCode = json.user_code || json.usercode;
	if (!json.device_auth_id || !userCode) throw new Error(`Codex device-code response missing fields: ${JSON.stringify(json)}`);
	return {
		verificationUrl: `${AUTH_BASE_URL}/codex/device`,
		userCode,
		deviceAuthId: json.device_auth_id,
		interval: Math.max(1, Number(json.interval || 5)),
	};
}

async function pollDeviceCode(deviceAuthId: string, userCode: string, intervalSeconds: number): Promise<DevicePollResponse> {
	const started = Date.now();
	while (Date.now() - started < DEVICE_TIMEOUT_MS) {
		const response = await fetch(`${ACCOUNTS_API_URL}/deviceauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
		});
		if (response.ok) {
			const json = (await response.json()) as DevicePollResponse;
			if (!json.authorization_code || !json.code_verifier) {
				throw new Error(`Codex device-token response missing fields: ${JSON.stringify(json)}`);
			}
			return json;
		}
		if (response.status !== 403 && response.status !== 404) {
			const text = await response.text().catch(() => "");
			throw new Error(`Codex device-token poll failed (${response.status}): ${text || response.statusText}`);
		}
		await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
	}
	throw new Error("Codex device auth timed out after 15 minutes");
}

async function exchangeDeviceAuthorizationCode(code: string, verifier: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: DEVICE_REDIRECT_URI,
		}),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Codex device-code token exchange failed (${response.status}): ${text || response.statusText}`);
	}
	const json = (await response.json()) as TokenResponse;
	if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
		throw new Error(`Codex device-code token response missing fields: ${JSON.stringify(json)}`);
	}
	const credentials: OAuthCredentials = {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
	};
	const accountId = getAccountId(json.access_token);
	if (accountId) credentials.accountId = accountId;
	return credentials;
}

async function loginOpenAICodexDevice(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const device = await requestDeviceCode();
	callbacks.onProgress?.(
		`Codex device login: open ${device.verificationUrl} and enter code ${device.userCode}. Waiting for approval...`,
	);
	const credentials = await pollDeviceCode(device.deviceAuthId, device.userCode, device.interval).then((result) =>
		exchangeDeviceAuthorizationCode(result.authorization_code, result.code_verifier),
	);
	callbacks.onProgress?.("Codex device login approved.");
	return credentials;
}

function readConfiguredAccounts(accountConfigPath: string): string[] {
	let raw = process.env[ACCOUNT_ENV] || "";
	if (!raw && existsSync(accountConfigPath)) {
		try {
			const parsed = JSON.parse(readFileSync(accountConfigPath, "utf8")) as AccountConfig;
			raw = (parsed.accounts || []).join(",");
		} catch {
			raw = "";
		}
	}

	const seen = new Set<string>();
	return raw
		.split(",")
		.map(normalizeAccountName)
		.filter((name) => name && !seen.has(name) && seen.add(name));
}

function writeConfiguredAccounts(accountConfigPath: string, accounts: string[]) {
	mkdirSync(dirname(accountConfigPath), { recursive: true });
	const seen = new Set<string>();
	const clean = accounts.map(normalizeAccountName).filter((name) => name && !seen.has(name) && seen.add(name));
	writeFileSync(accountConfigPath, `${JSON.stringify({ accounts: clean }, null, 2)}\n`, { mode: 0o600 });
}

function readAuthProviderIds(authPath: string): string[] {
	try {
		if (!existsSync(authPath)) return [];
		const parsed = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
		return Object.keys(parsed).filter((key) => key === BASE_PROVIDER || key.startsWith(`${BASE_PROVIDER}-`));
	} catch {
		return [];
	}
}

export default async function codexAccounts(pi: ExtensionAPI) {
	const ai = await loadAiCompat();
	const agentDir = await getAgentDir();
	const accountConfigPath = join(agentDir, "codex-accounts.json");
	const authPath = join(agentDir, "auth.json");
	let accounts = readConfiguredAccounts(accountConfigPath);
	const baseModels = ai.getModels(BASE_PROVIDER);
	const registered = new Set<string>();

	function registerAccountProvider(account: string) {
		account = normalizeAccountName(account);
		if (!account || registered.has(account)) return;
		registered.add(account);

		pi.registerProvider(providerFor(account), {
			name: `ChatGPT Codex (${account})`,
			baseUrl: BASE_URL,
			api: API,
			models: baseModels.map((model) => ({
				id: model.id,
				name: `${model.name} (${account})`,
				api: model.api,
				baseUrl: model.baseUrl,
				reasoning: model.reasoning,
				thinkingLevelMap: model.thinkingLevelMap,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				compat: model.compat,
			})),
			oauth: {
				name: `ChatGPT Plus/Pro (Codex device: ${account})`,
				login: loginOpenAICodexDevice,
				refreshToken: ai.refreshToken,
				getApiKey: ai.getApiKey,
			},
		});
	}

	for (const account of accounts) registerAccountProvider(account);

	function visibleAccounts(ctx: ExtensionCommandContext): string[] {
		const names = new Set<string>();
		if (ctx.modelRegistry.authStorage.get(BASE_PROVIDER)) names.add("current");
		for (const account of accounts) names.add(account);
		for (const provider of readAuthProviderIds(authPath)) {
			const account = accountForProvider(provider);
			if (account) names.add(account);
		}
		return [...names];
	}

	async function switchToAccount(account: string, ctx: ExtensionCommandContext) {
		const provider = account === "current" ? BASE_PROVIDER : providerFor(account);
		const currentModelId = ctx.model?.provider?.startsWith(BASE_PROVIDER) ? ctx.model.id : undefined;
		const modelId = currentModelId && baseModels.some((model) => model.id === currentModelId)
			? currentModelId
			: baseModels[0]?.id;
		const model = modelId ? ctx.modelRegistry.find(provider, modelId) : undefined;

		if (!model) {
			ctx.ui.notify(`No Codex model found for ${provider}`, "error");
			return;
		}

		const ok = await pi.setModel(model);
		if (!ok) {
			ctx.ui.notify(`Not logged in for ${account}. Choose '${ADD_ACCOUNT}' to use device-code login.`, "error");
			return;
		}

		ctx.ui.notify(`Switched to ChatGPT/Codex account: ${account}`, "success");
	}

	async function loginNewAccount(ctx: ExtensionCommandContext) {
		const rawName = await ctx.ui.input("Name this ChatGPT/Codex account alias:", "work");
		const account = normalizeAccountName(rawName || "");
		if (!account || account === "current") {
			ctx.ui.notify("Account alias must be a non-empty name other than 'current'.", "error");
			return;
		}

		registerAccountProvider(account);
		ctx.modelRegistry.refresh();
		const provider = providerFor(account);

		try {
			await ctx.modelRegistry.authStorage.login(provider, {
				onAuth: () => undefined,
				onPrompt: (prompt) => ctx.ui.input(prompt.message, prompt.placeholder || ""),
				onProgress: (message) => ctx.ui.notify(message, "info"),
			});

			if (!accounts.includes(account)) {
				accounts = [...accounts, account];
				writeConfiguredAccounts(accountConfigPath, accounts);
			}
			ctx.modelRegistry.refresh();
			await switchToAccount(account, ctx);
		} catch (error) {
			ctx.ui.notify(`Device-code login failed for ${account}: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	}

	pi.registerCommand("codex-account", {
		description: "Switch/add ChatGPT/Codex OAuth accounts using device-code auth",
		getArgumentCompletions: (prefix: string) => {
			const normalized = normalizeAccountName(prefix);
			return ["current", ...accounts]
				.filter((account) => account.startsWith(normalized))
				.map((account) => ({
					value: account,
					label: account,
					description: account === "current" ? BASE_PROVIDER : providerFor(account),
				}));
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const direct = normalizeAccountName(args);
			if (direct) {
				if (direct !== "current") registerAccountProvider(direct);
				await switchToAccount(direct, ctx);
				return;
			}

			const current = accountForProvider(ctx.model?.provider);
			const accountItems = visibleAccounts(ctx);
			const labels = [
				...accountItems.map((account) => `${account}${account === current ? "  ✓ active" : ""}`),
				ADD_ACCOUNT,
				CANCEL,
			];
			const selected = await ctx.ui.select("ChatGPT/Codex accounts", labels);
			if (!selected || selected === CANCEL) return;
			if (selected === ADD_ACCOUNT) {
				await loginNewAccount(ctx);
				return;
			}
			await switchToAccount(selected.replace(/\s+✓ active$/, ""), ctx);
		},
	});

	pi.on("model_select", (event, ctx) => {
		const account = accountForProvider(event.model.provider);
		if (!account) return;
		ctx.ui.setStatus("codex-account", account);
	});
}
