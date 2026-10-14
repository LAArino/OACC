#!/bin/sh
# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# curl smoke test of the OEAPI mock: every endpoint, pagination boundaries,
# consumer filter, `since`, the four auth modes, 429 and 503 injection.
# Starts throw-away server instances on local ports 18091-18097.
#
#   sh tools/oeapi-mock/scripts/smoke.sh
set -u

here=$(cd "$(dirname "$0")/.." && pwd)
pids=""
pass=0
failed=0
trap 'for p in $pids; do kill "$p" 2>/dev/null; done' EXIT

start() { # port, then VAR=value ... for the server environment
  port=$1
  shift
  env PORT="$port" OEAPI_MOCK_TODAY=2026-10-14 "$@" node "$here/server.mjs" 2>/dev/null &
  pids="$pids $!"
  i=0
  until curl -s -o /dev/null "http://127.0.0.1:$port/" || [ $i -ge 50 ]; do sleep 0.1; i=$((i + 1)); done
}

expect() { # description, expected, actual
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1))
    printf 'ok    %s\n' "$1"
  else
    failed=$((failed + 1))
    printf 'FAIL  %s: expected [%s], got [%s]\n' "$1" "$2" "$3"
  fi
}

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json() { # url, then a JS expression over `d` (the parsed body)
  curl -s -u oecp:oecp-mock-secret "$1" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);console.log($2)})"
}

# --- Basic auth instance (the Compose default) ------------------------------
B=http://127.0.0.1:18091
start 18091 OEAPI_MOCK_AUTH=basic:oecp:oecp-mock-secret
U="-u oecp:oecp-mock-secret"

expect 'GET / without credentials -> 401' 401 "$(code $B/)"
expect '401 carries WWW-Authenticate: Basic' 'Basic' "$(curl -s -o /dev/null -D - $B/courses | tr -d '\r' | sed -n 's/^[Ww][Ww][Ww]-[Aa]uthenticate: \([A-Za-z]*\).*/\1/p')"
expect 'wrong password -> 401' 401 "$(code -u oecp:wrong $B/courses)"
expect 'GET / service document' 'oeapi-mock@uibk.example' "$(json $B/ 'd.contactEmail')"
expect 'Content-Type application/json' 'application/json' "$(curl -s -o /dev/null -w '%{content_type}' $U $B/courses)"
expect 'organizations?organizationType=root' '1 root UIBK' "$(json "$B/organizations?organizationType=root" 'd.items.length+" "+d.items[0].organizationType+" "+d.items[0].shortName')"
ORG=$(json "$B/organizations?organizationType=root" 'd.items[0].organizationId')
expect 'organizations/{id}' 'uibk.ac.at' "$(json "$B/organizations/$ORG" 'd.primaryCode.code')"
expect 'courses default page (pageSize 10, 25 courses)' '10 true false 3' "$(json "$B/courses" 'd.items.length+" "+d.hasNextPage+" "+d.hasPreviousPage+" "+d.totalPages')"
expect 'courses page 3 is the last' '5 false true' "$(json "$B/courses?pageNumber=3" 'd.items.length+" "+d.hasNextPage+" "+d.hasPreviousPage')"
expect 'courses page past the end -> empty' '0 false true' "$(json "$B/courses?pageNumber=4" 'd.items.length+" "+d.hasNextPage+" "+d.hasPreviousPage')"
expect 'pageSize above 100 is capped' '100 25' "$(json "$B/courses?pageSize=250" 'd.pageSize+" "+d.items.length')"
expect 'pageSize=0 -> 400' 400 "$(code $U "$B/courses?pageSize=0")"
expect 'consumer=eduxchange -> 20 courses' 20 "$(json "$B/courses?consumer=eduxchange&pageSize=100" 'd.items.length')"
expect 'consumer=eduxchange hides the 5 internal courses' '' "$(json "$B/courses?consumer=eduxchange&pageSize=100" 'd.items.map(c=>c.primaryCode.code).filter(c=>["703900","300900","201900","401999","609999"].includes(c)).join(",")')"
expect 'consumer=rio -> 0 courses' 0 "$(json "$B/courses?consumer=rio" 'd.items.length')"
expect 'teachingLanguage=ger (ISO 639-2/B)' true "$(json "$B/courses?teachingLanguage=ger&pageSize=100" 'd.items.length>0&&d.items.every(c=>c.teachingLanguage==="ger")')"
expect 'teachingLanguage=deu matches nothing (data uses ger)' 0 "$(json "$B/courses?teachingLanguage=deu" 'd.items.length')"
expect 'teachingLanguage=mul' 620050 "$(json "$B/courses?teachingLanguage=mul" 'd.items.map(c=>c.primaryCode.code).join()')"
expect 'level=master' true "$(json "$B/courses?level=master&pageSize=100" 'd.items.length>0&&d.items.every(c=>c.level==="master")')"
expect 'modeOfDelivery=situated' '201900,609010,609999,620050' "$(json "$B/courses?modeOfDelivery=situated&pageSize=100" 'd.items.map(c=>c.primaryCode.code).sort().join()')"
expect 'search=glacier (q alias)' 609010 "$(json "$B/courses?search=glacier" 'd.items.map(c=>c.primaryCode.code).join()')"
expect 'primaryCode=703015' '703015 7.5' "$(json "$B/courses?primaryCode=703015" 'd.items[0].primaryCode.code+" "+d.items[0].studyLoad.value')"
C=$(json "$B/courses?primaryCode=401210" 'd.items[0].courseId')
expect 'courses/{id}' 401210 "$(json "$B/courses/$C" 'd.primaryCode.code')"
expect 'courses/{unknown} -> 404 problem' '404 application/problem+json' "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' $U $B/courses/00000000-0000-4000-8000-000000000000)"
expect 'offerings default since=today hides started winter offering' '401210-2027S' "$(json "$B/courses/$C/offerings" 'd.items.map(o=>o.primaryCode.code).join()')"
expect 'offerings since=2025-10-14 shows both' '401210-2026W,401210-2027S' "$(json "$B/courses/$C/offerings?since=2025-10-14" 'd.items.map(o=>o.primaryCode.code).join()')"
expect 'offerings until=2027-02-28' '401210-2026W' "$(json "$B/courses/$C/offerings?since=2025-10-14&until=2027-02-28" 'd.items.map(o=>o.primaryCode.code).join()')"
expect 'since=garbage -> 400' 400 "$(code $U "$B/courses/$C/offerings?since=14.10.2026")"
O=$(json "$B/courses/$C/offerings" 'd.items[0].offeringId')
expect 'offerings/{id} unexpanded' 'string string' "$(json "$B/offerings/$O" 'typeof d.academicSession+" "+typeof d.course')"
expect 'offerings/{id}?expand=academicSession,course' '2027S 401210' "$(json "$B/offerings/$O?expand=academicSession,course" 'd.academicSession.primaryCode.code+" "+d.course.primaryCode.code')"
expect 'academic-sessions' '2026/27,2026W,2027S' "$(json "$B/academic-sessions" 'd.items.map(s=>s.primaryCode.code).join()')"
AY=$(json "$B/academic-sessions" 'd.items[0].academicSessionId')
expect 'academic-sessions/{id}?expand=children' '2026W,2027S' "$(json "$B/academic-sessions/$AY?expand=children" 'd.children.map(s=>s.primaryCode.code).join()')"
expect 'unknown route -> 404' 404 "$(code $U $B/programs)"
expect 'POST -> 405' 405 "$(code $U -X POST $B/courses)"
expect 'Accept v6 -> 406' 406 "$(code $U -H 'Accept: application/vnd.oeapi+json;version=6' $B/courses)"

# --- Bearer, API key, none ---------------------------------------------------
start 18092 OEAPI_MOCK_AUTH=bearer:t0ken
expect 'bearer: missing -> 401' 401 "$(code http://127.0.0.1:18092/courses)"
expect 'bearer: wrong -> 401' 401 "$(code -H 'Authorization: Bearer nope' http://127.0.0.1:18092/courses)"
expect 'bearer: right -> 200' 200 "$(code -H 'Authorization: Bearer t0ken' http://127.0.0.1:18092/courses)"
start 18093 OEAPI_MOCK_AUTH=apikey:X-API-Key:k3y
expect 'apikey: missing -> 401' 401 "$(code http://127.0.0.1:18093/courses)"
expect 'apikey: wrong -> 401' 401 "$(code -H 'X-API-Key: nope' http://127.0.0.1:18093/courses)"
expect 'apikey: right -> 200' 200 "$(code -H 'X-API-Key: k3y' http://127.0.0.1:18093/courses)"
start 18094 OEAPI_MOCK_AUTH=none
expect 'none: no credentials -> 200' 200 "$(code http://127.0.0.1:18094/courses)"

# --- Rate limit and fault injection -------------------------------------------
start 18095 OEAPI_MOCK_AUTH=none OEAPI_MOCK_RATE_LIMIT_PER_SEC=3
codes=$(for i in 1 2 3 4 5 6; do code http://127.0.0.1:18095/courses; printf ' '; done)
expect 'rate limit 3/s: 4th request in the same second -> 429' 'yes' "$(echo "$codes" | grep -q 429 && echo yes || echo "no ($codes)")"
expect '429 carries Retry-After' 1 "$(for i in 1 2 3 4 5; do curl -s -o /dev/null -D - http://127.0.0.1:18095/courses; done | tr -d '\r' | sed -n 's/^[Rr]etry-[Aa]fter: //p' | head -1)"
start 18096 OEAPI_MOCK_AUTH=none OEAPI_MOCK_FAIL_RATE=1
expect 'fail rate 1 -> 503' 503 "$(code http://127.0.0.1:18096/courses)"
start 18097 OEAPI_MOCK_AUTH=none OEAPI_MOCK_FAIL_RATE=0.5
n=0
for i in $(seq 1 40); do [ "$(code http://127.0.0.1:18097/courses)" = 503 ] && n=$((n + 1)); done
expect 'fail rate 0.5 -> some but not all of 40 requests are 503' yes "$([ $n -gt 0 ] && [ $n -lt 40 ] && echo yes || echo "no ($n)")"

printf '\n%s passed, %s failed\n' "$pass" "$failed"
[ "$failed" -eq 0 ]
