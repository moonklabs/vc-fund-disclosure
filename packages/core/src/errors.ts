/** 아직 구현되지 않은 기능을 명시적으로 표시하는 에러. 조용히 넘어가지 않는다. */
export class NotImplementedError extends Error {
  constructor(feature: string, roadmapNote?: string) {
    const suffix = roadmapNote ? ` (로드맵: ${roadmapNote})` : "";
    super(`${feature}은(는) 아직 구현되지 않았습니다.${suffix}`);
    this.name = "NotImplementedError";
  }
}

/** 수집 경계 정책 위반. */
export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}
