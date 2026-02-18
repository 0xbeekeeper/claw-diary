export interface DiaryEvent {
    id: string;
    timestamp: string;
    sessionId: string;
    type: 'tool_call' | 'tool_result' | 'session_start' | 'session_end';
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    result?: {
        success: boolean;
        outputPreview: string;
    };
    tokenUsage?: {
        input: number;
        output: number;
        estimatedCost: number;
    };
    model?: string;
    duration?: number;
}
export interface DiarySummary {
    date: string;
    totalSessions: number;
    totalDuration: number;
    totalTokens: number;
    totalCost: number;
    sessions: SessionSummary[];
    insights: string[];
    markdown: string;
}
export interface SessionSummary {
    sessionId: string;
    startTime: string;
    endTime: string;
    duration: number;
    toolCalls: number;
    tokens: number;
    cost: number;
    topTools: {
        name: string;
        count: number;
    }[];
    failures: number;
    description: string;
}
export interface DiaryAnalytics {
    dailyCost: number;
    weeklyCost: number;
    costByModel: Record<string, number>;
    costByToolType: Record<string, number>;
    costTrend: {
        date: string;
        cost: number;
    }[];
    totalSessions: number;
    totalToolCalls: number;
    avgSessionDuration: number;
    topTools: {
        name: string;
        count: number;
        cost: number;
    }[];
    failureRate: number;
    patterns: {
        description: string;
        confidence: number;
        suggestion?: string;
    }[];
}
export interface DiaryConfig {
    recordingLevel: 'full' | 'summary' | 'minimal';
    dataDir: string;
}
export declare const MODEL_PRICING: Record<string, {
    input: number;
    output: number;
}>;
export declare function getDataDir(): string;
export declare function getEventsDir(): string;
export declare function getTodayFileName(): string;
export declare function getDateFileName(date: Date): string;
export declare function estimateCost(model: string, inputTokens: number, outputTokens: number): number;
export declare function loadEventsForDate(date: Date): DiaryEvent[];
export declare function loadEventsForDays(days: number): DiaryEvent[];
export declare function formatDuration(ms: number): string;
export declare function formatCost(cost: number): string;
export declare function formatTokens(tokens: number): string;
export declare function loadConfig(): DiaryConfig;
//# sourceMappingURL=types.d.ts.map