import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginTheme } from "@getpaseo/plugin";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { useTranslation } from "@getpaseo/plugin/client";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import type {
  importSession,
  listSessions,
  SessionStatus,
  SessionSummary,
} from "../shared/contracts.js";
import { ImporterError } from "../shared/errors.js";
import { messages } from "./messages.js";

export interface SessionPickerProps {
  hostId: string;
  workspaceId: string;
  directory: string | null;
  workspaceName: string | null;
  theme: PluginTheme;
  compact: boolean;
  list(input: RpcInput<typeof listSessions>): Promise<RpcOutput<typeof listSessions>>;
  importOne(input: RpcInput<typeof importSession>): Promise<RpcOutput<typeof importSession>>;
  openAgent?: (agentId: string) => void;
}

interface Filters {
  draft: string;
  query: string;
  status: SessionStatus;
}

type FilterAction =
  | { type: "draft"; value: string }
  | { type: "search" }
  | { type: "status"; value: SessionStatus };

function filterReducer(state: Filters, action: FilterAction): Filters {
  if (action.type === "draft") return { ...state, draft: action.value };
  if (action.type === "search") return { ...state, query: state.draft.trim() };
  return { ...state, status: action.value };
}

function firstCursor(): string | null {
  return null;
}

const statusChoices: ReadonlyArray<SessionStatus> = ["all", "archived", "active"];

export function SessionPicker(props: SessionPickerProps) {
  const { colors } = props.theme;
  const { t, locale } = useTranslation(messages);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  function errorMessage(error: unknown) {
    if (error instanceof ImporterError) return t(`errors.${error.code}`);
    return t("errors.generic");
  }
  const [filters, dispatch] = useReducer(filterReducer, { draft: "", query: "", status: "all" });
  const cache = useQueryClient();
  const pendingThread = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const queryPrefix = ["codex-importer", props.hostId, props.workspaceId];
  const queryKey = [...queryPrefix, props.directory, filters.status, filters.query];
  const sessions = useInfiniteQuery({
    queryKey,
    initialPageParam: firstCursor(),
    queryFn: async ({ pageParam }) => {
      const result = await props.list({
        workspaceId: props.workspaceId,
        status: filters.status,
        query: filters.query,
        cursor: pageParam,
      });
      if (!result.ok) throw new ImporterError(result.error);
      return result;
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: props.directory !== null,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    gcTime: 0,
  });
  const importing = useMutation({
    mutationFn: async (entry: SessionSummary) => {
      const result = await props.importOne({
        workspaceId: props.workspaceId,
        threadId: entry.id,
        archived: entry.archived,
      });
      if (!result.ok) throw new ImporterError(result.error);
      return result;
    },
    onSuccess: (result) => {
      void cache.resetQueries({ queryKey: queryPrefix });
      if (mounted.current) props.openAgent?.(result.agentId);
    },
    onSettled: () => {
      pendingThread.current = null;
    },
  });

  function startImport(entry: SessionSummary) {
    // Two presses can arrive before React commits the mutation's pending state.
    if (pendingThread.current !== null) return;
    pendingThread.current = entry.id;
    importing.mutate(entry);
  }
  const unique = new Map<string, SessionSummary>();
  let filteredCount = 0;
  for (const page of sessions.data?.pages ?? []) {
    filteredCount += page.filteredCount;
    for (const entry of page.entries) unique.set(entry.id, entry);
  }
  const entries = [...unique.values()];
  const text = { color: colors.foreground, fontSize: 14, lineHeight: 21 };
  const muted = { ...text, color: colors.foregroundMuted };
  const control: ViewStyle = {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    justifyContent: "center",
    minHeight: 40,
  };

  return (
    <View
      testID="codex-session-picker"
      accessibilityLanguage={locale}
      style={{ flex: 1, backgroundColor: colors.surface0 }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: props.compact ? 16 : 24,
          gap: 20,
          width: "100%",
          maxWidth: 1000,
          alignSelf: "center",
        }}
      >
        <View style={{ gap: 8 }}>
          <Text
            accessibilityRole="header"
            style={{ ...text, fontSize: 22, lineHeight: 30, fontWeight: "600" }}
          >
            {t("title")}
          </Text>
          <Text style={muted}>{t("description")}</Text>
          <Text style={muted} numberOfLines={2}>
            {props.workspaceName ?? t("currentWorkspace")} ·{" "}
            {props.directory ?? t("workspaceUnavailable")}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              accessibilityLabel={t("searchLabel")}
              placeholder={t("searchPlaceholder")}
              placeholderTextColor={colors.foregroundMuted}
              value={filters.draft}
              maxLength={200}
              onChangeText={(value) => dispatch({ type: "draft", value })}
              onSubmitEditing={() => dispatch({ type: "search" })}
              returnKeyType="search"
              style={{
                ...text,
                flex: 1,
                minWidth: 0,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 6,
                paddingHorizontal: 12,
                paddingVertical: 9,
                backgroundColor: colors.surface1,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("search")}
              onPress={() => dispatch({ type: "search" })}
              style={{ ...control, backgroundColor: colors.surface1 }}
            >
              <Text style={text}>{t("search")}</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {statusChoices.map((value) => {
              const label = t(value);
              const selected = filters.status === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                  onPress={() => dispatch({ type: "status", value })}
                  style={{
                    ...control,
                    backgroundColor: selected ? colors.accent : colors.surface1,
                  }}
                >
                  <Text
                    style={{
                      ...text,
                      color: selected ? colors.accentForeground : colors.foreground,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("refreshLabel")}
              disabled={sessions.isFetching || importing.isPending}
              onPress={() => {
                void cache.resetQueries({ queryKey });
              }}
              style={control}
            >
              <Text style={{ ...text, color: colors.accent }}>
                {sessions.isFetching ? t("loading") : t("refresh")}
              </Text>
            </Pressable>
          </View>
        </View>

        {!props.directory ? (
          <Text accessibilityRole="alert" style={text}>
            {t("errors.workspace_unavailable")}
          </Text>
        ) : null}
        {sessions.isError ? (
          <View accessibilityRole="alert" style={{ gap: 4 }}>
            <Text style={text}>{errorMessage(sessions.error)}</Text>
            <Text style={muted}>{t("retryList")}</Text>
          </View>
        ) : null}
        {importing.isError ? (
          <Text accessibilityRole="alert" style={text}>
            {errorMessage(importing.error)}
          </Text>
        ) : null}
        {importing.isSuccess ? (
          <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
            <Text style={text}>{t("importSuccess")}</Text>
            {props.openAgent ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => props.openAgent?.(importing.data.agentId)}
              >
                <Text style={{ ...text, color: colors.accent }}>{t("openImported")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {sessions.isPending && props.directory ? (
          <ActivityIndicator accessibilityLabel={t("loadingHistory")} color={colors.accent} />
        ) : null}

        <View>
          {entries.map((entry) => (
            <View
              key={entry.id}
              style={{
                paddingVertical: 16,
                gap: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ ...text, flex: 1, fontWeight: "500" }} numberOfLines={2}>
                  {entry.title || t("untitled")}
                </Text>
                <Text style={{ ...muted, fontSize: 12 }}>
                  {entry.archived ? t("archived") : t("active")}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ ...muted, flex: 1, fontSize: 12 }}>
                  {dateFormatter.format(entry.updatedAt * 1000)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("importLabel", { title: entry.title || t("untitled") })}
                  disabled={importing.isPending}
                  onPress={() => startImport(entry)}
                  style={{
                    ...control,
                    backgroundColor: colors.accent,
                    opacity: importing.isPending ? 0.6 : 1,
                  }}
                >
                  <Text style={{ ...text, color: colors.accentForeground }}>
                    {importing.isPending && importing.variables.id === entry.id
                      ? t("importing")
                      : t("import")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
        {sessions.isSuccess && entries.length === 0 ? (
          <Text style={muted}>{sessions.hasNextPage ? t("emptyMore") : t("empty")}</Text>
        ) : null}
        {sessions.hasNextPage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("loadMoreLabel")}
            disabled={sessions.isFetching}
            onPress={() => {
              void sessions.fetchNextPage();
            }}
            style={{ ...control, alignSelf: "center" }}
          >
            <Text style={{ ...text, color: colors.accent }}>
              {sessions.isFetchingNextPage ? t("loading") : t("loadMore")}
            </Text>
          </Pressable>
        ) : null}
        <Text style={{ ...muted, fontSize: 12 }}>
          {filteredCount > 0 ? t("filtered", { count: filteredCount }) : t("excluded")}{" "}
          {t("restoreHint")}
        </Text>
      </ScrollView>
    </View>
  );
}
