export type DefectSeverity = "CRITICAL" | "MEDIUM" | "LOW";
export type Defect = { id: string; type: string; severity: DefectSeverity; location_description: string; confidence: number; recommendation: string };
export type InspectionResult = { fabric_quality: "PASS" | "WARNING" | "FAIL"; overall_score: number; summary: string; defects: Defect[]; model_used?: string };
export type AuditEntry = { id: string; timestamp: string; fabric_quality: InspectionResult["fabric_quality"]; defects: number; imageName: string };
