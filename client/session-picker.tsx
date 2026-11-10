import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginTheme } from "@getpaseo/plugin";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useRef } from "react";
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
import { type ErrorCode, ImporterError } from "../shared/errors.js";

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

const errors: Record<ErrorCode, string> = {
  codex_unavailable: "未找到 Codex CLI。请在 Paseo 主机上安装 Codex，并检查 PATH。",
  codex_failed: "Codex 无法读取或恢复这条历史。请刷新列表；若仍失败，请检查 Codex 版本和历史文件。",
  timeout: "请求超时。请刷新列表确认会话状态后重试。",
  invalid_cursor: "历史列表已变化。请点击刷新，重新加载第一页。",
  workspace_unavailable: "当前工作区不可用。请回到工作区后重新打开导入面板。",
  wrong_directory: "该会话属于其他目录。请切换到对应工作区后导入。",
  already_imported: "该会话已在 Paseo 中打开。请使用现有会话，或刷新列表。",
  import_in_progress: "该会话正在导入，请等待完成。",
  import_failed: "导入尚未完成。请刷新后重试；已恢复的 Codex 历史会保留在未归档列表。",
  daemon_unavailable: "无法连接当前 Paseo 主机。请检查连接后重试。",
  host_mismatch: "导入服务与当前主机不一致。请重新连接目标主机。",
  configuration_invalid: "Codex 配置不可用。请检查 Paseo 中 Codex 的启用状态和启动命令。",
  plugin_stopped: "插件已停止。请重新打开导入面板。",
};

function errorMessage(error: unknown) {
  if (error instanceof ImporterError) return errors[error.code];
  return "无法连接导入服务。请检查主机连接后重试。";
}

function firstCursor(): string | null {
  return null;
}

const statusChoices: ReadonlyArray<{ value: SessionStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "archived", label: "已归档" },
  { value: "active", label: "未归档" },
];

export function SessionPicker(props: SessionPickerProps) {
  const { colors } = props.theme;
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
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
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
            导入 Codex 会话
          </Text>
          <Text style={muted}>查找当前目录的 Codex 历史，包括已归档的会话。</Text>
          <Text style={muted} numberOfLines={2}>
            {props.workspaceName ?? "当前工作区"} · {props.directory ?? "工作区不可用"}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              accessibilityLabel="搜索 Codex 会话标题"
              placeholder="搜索会话标题…"
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
              accessibilityLabel="搜索"
              onPress={() => dispatch({ type: "search" })}
              style={{ ...control, backgroundColor: colors.surface1 }}
            >
              <Text style={text}>搜索</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {statusChoices.map((choice) => {
              const selected = filters.status === choice.value;
              return (
                <Pressable
                  key={choice.value}
                  accessibilityRole="button"
                  accessibilityLabel={choice.label}
                  accessibilityState={{ selected }}
                  onPress={() => dispatch({ type: "status", value: choice.value })}
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
                    {choice.label}
                  </Text>
                </Pressable>
              );
            })}
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新列表"
              disabled={sessions.isFetching || importing.isPending}
              onPress={() => {
                void cache.resetQueries({ queryKey });
              }}
              style={control}
            >
              <Text style={{ ...text, color: colors.accent }}>
                {sessions.isFetching ? "加载中…" : "刷新"}
              </Text>
            </Pressable>
          </View>
        </View>

        {!props.directory ? (
          <Text accessibilityRole="alert" style={text}>
            {errors.workspace_unavailable}
          </Text>
        ) : null}
        {sessions.isError ? (
          <View accessibilityRole="alert" style={{ gap: 4 }}>
            <Text style={text}>{errorMessage(sessions.error)}</Text>
            <Text style={muted}>点击“刷新”可重新查询。</Text>
          </View>
        ) : null}
        {importing.isError ? (
          <Text accessibilityRole="alert" style={text}>
            {errorMessage(importing.error)}
          </Text>
        ) : null}
        {importing.isSuccess ? (
          <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
            <Text style={text}>会话已导入当前工作区。</Text>
            {props.openAgent ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => props.openAgent?.(importing.data.agentId)}
              >
                <Text style={{ ...text, color: colors.accent }}>打开已导入的会话</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {sessions.isPending && props.directory ? (
          <ActivityIndicator accessibilityLabel="正在读取 Codex 历史" color={colors.accent} />
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
                  {entry.title || "未命名 Codex 会话"}
                </Text>
                <Text style={{ ...muted, fontSize: 12 }}>
                  {entry.archived ? "已归档" : "未归档"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ ...muted, flex: 1, fontSize: 12 }}>
                  {new Date(entry.updatedAt * 1000).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`导入 ${entry.title || "未命名 Codex 会话"}`}
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
                      ? "正在导入…"
                      : "导入"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
        {sessions.isSuccess && entries.length === 0 ? (
          <Text style={muted}>
            {sessions.hasNextPage
              ? "当前批次中的会话已在 Paseo 中打开，可继续加载更早的历史。"
              : "当前目录没有匹配的可导入会话。可切换归档状态、清空搜索或刷新列表。"}
          </Text>
        ) : null}
        {sessions.hasNextPage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="加载更多会话"
            disabled={sessions.isFetching}
            onPress={() => {
              void sessions.fetchNextPage();
            }}
            style={{ ...control, alignSelf: "center" }}
          >
            <Text style={{ ...text, color: colors.accent }}>
              {sessions.isFetchingNextPage ? "加载中…" : "加载更多"}
            </Text>
          </Pressable>
        ) : null}
        <Text style={{ ...muted, fontSize: 12 }}>
          {filteredCount > 0
            ? `已过滤 ${filteredCount} 条在 Paseo 中打开的会话。`
            : "已在 Paseo 中打开的会话不会重复显示。"}{" "}
          仅点击导入时恢复所选会话。
        </Text>
      </ScrollView>
    </View>
  );
}
