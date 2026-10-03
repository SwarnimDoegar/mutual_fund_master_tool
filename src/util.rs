use chrono::{Datelike, Duration, NaiveDate, Weekday};

/// mfapi.in dates look like `01-10-2026` (day-month-year).
pub fn parse_api_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%d-%m-%Y").ok()
}

/// NAVs arrive as strings like `"205.75400"`; anything non-numeric or non-positive is unusable.
pub fn parse_nav(s: &str) -> Option<f64> {
    let v: f64 = s.trim().replace(',', "").parse().ok()?;
    (v.is_finite() && v > 0.0).then_some(v)
}

/// True when some Monday–Friday lies strictly between `stored` and `latest`.
///
/// The daily snapshot only carries each scheme's newest NAV. If a weekday sits between the
/// newest NAV we already hold and the snapshot's NAV, we may have missed a publication (a skipped
/// run, a late-publishing AMC, or a market holiday), so the scheme's range is re-fetched.
/// Ordinary days (Mon→Tue, Fri→Mon) never trigger a re-fetch.
pub fn has_weekday_between(stored: NaiveDate, latest: NaiveDate) -> bool {
    let mut d = stored + Duration::days(1);
    while d < latest {
        if !matches!(d.weekday(), Weekday::Sat | Weekday::Sun) {
            return true;
        }
        d += Duration::days(1);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn parses_api_dates_and_navs() {
        assert_eq!(parse_api_date("01-10-2026"), Some(d("2026-10-01")));
        assert_eq!(parse_api_date("2026-10-01"), None);
        assert_eq!(parse_nav("205.75400"), Some(205.754));
        assert_eq!(parse_nav("1,151.92"), Some(1151.92));
        assert_eq!(parse_nav("0.00000"), None);
        assert_eq!(parse_nav("N.A."), None);
        assert_eq!(parse_nav("-1"), None);
    }

    #[test]
    fn consecutive_trading_days_need_no_refetch() {
        // Thu 2026-10-01 -> Fri 2026-10-02
        assert!(!has_weekday_between(d("2026-10-01"), d("2026-10-02")));
        // Fri -> Mon across a weekend
        assert!(!has_weekday_between(d("2026-10-02"), d("2026-10-05")));
        // Same day or stored ahead of snapshot (liquid funds publish weekend NAVs early)
        assert!(!has_weekday_between(d("2026-10-05"), d("2026-10-05")));
        assert!(!has_weekday_between(d("2026-10-05"), d("2026-10-03")));
    }

    #[test]
    fn skipped_weekday_triggers_refetch() {
        // Mon -> Wed: Tuesday's NAV is missing
        assert!(has_weekday_between(d("2026-10-05"), d("2026-10-07")));
        // Thu -> Mon: Friday missing
        assert!(has_weekday_between(d("2026-10-01"), d("2026-10-05")));
    }
}
