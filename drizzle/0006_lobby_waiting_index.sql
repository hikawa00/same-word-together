CREATE INDEX IF NOT EXISTS rooms_lobby_waiting_seen_idx
ON rooms (is_public, status, player_two_token, last_seen_at);