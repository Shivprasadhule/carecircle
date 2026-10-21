export const TOOL_LABEL: Record<string, string> = {
  recall_memories: 'Remembering what I know about you',
  get_care_snapshot: "Checking today's care plan",
  list_todays_doses: 'Checking your medicines',
  log_dose: 'Logging your medicine',
  record_checkin: 'Saving how you are feeling',
  analyze_wellbeing_trends: 'Looking at the last few days',
  list_appointments: 'Checking your appointments',
  schedule_appointment: 'Booking the appointment',
  raise_family_alert: 'Letting your family know',
  list_alerts: 'Checking family alerts',
  resolve_alert: 'Closing the alert',
  remember: 'Remembering that for next time',
}
export const toolLabel = (t: string) => TOOL_LABEL[t] ?? t.replace(/_/g, ' ')
