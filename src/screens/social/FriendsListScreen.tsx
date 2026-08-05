import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UsersThree } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { EmptyState, InlineError } from '../../components/EmptyState';
import { Screen, ScreenHeader, SectionHeader } from '../../components/Screen';
import { SearchField } from '../../components/TextField';
import { SkeletonList } from '../../components/Skeleton';
import { showToast } from '../../components/Toast';
import { socialApi } from '../../api/endpoints';
import type { ChallengesStackParamList } from '../../navigation/types';
import { rankTitle } from '../../constants/game';
import type { User } from '../../models';
import { paper, spacing, text } from '../../theme';

/**
 * Friends.
 *
 * Incoming requests come first, because they need an answer. Search results are separate
 * from the friend list so adding somebody never looks like it already happened.
 */

type Props = NativeStackScreenProps<ChallengesStackParamList, 'FriendsList'>;

export function FriendsListScreen({ navigation }: Props) {
  const [friends, setFriends] = useState<User[]>([]);
  const [incoming, setIncoming] = useState<(User & { friendshipId: string })[]>([]);
  const [outgoing, setOutgoing] = useState<User[]>([]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFriends = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await socialApi.friends();
      setFriends(result.friends);
      setIncoming(result.incoming);
      setOutgoing(result.outgoing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not load your friends.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFriends();
  }, [fetchFriends]);

  // Debounced search. The server requires two characters, so short queries clear instead of
  // firing a request that would fail validation.
  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await socialApi.search(trimmed);
        setResults(result.users);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 340);

    return () => clearTimeout(timer);
  }, [query]);

  const add = useCallback(
    async (username: string) => {
      try {
        const result = await socialApi.addFriend(username);
        showToast(
          result.status === 'accepted' ? 'You are now friends' : 'Request sent',
          'success'
        );
        setQuery('');
        setResults([]);
        await fetchFriends();
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'We could not send that request',
          'error'
        );
      }
    },
    [fetchFriends]
  );

  const respond = useCallback(
    async (friendshipId: string, accept: boolean) => {
      try {
        await socialApi.respond(friendshipId, accept);
        showToast(accept ? 'Friend added' : 'Request declined', 'neutral');
        await fetchFriends();
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'That did not go through',
          'error'
        );
      }
    },
    [fetchFriends]
  );

  return (
    <Screen scroll>
      <ScreenHeader
        title="Friends"
        subtitle="See their collections and compare standings on the friends leaderboard."
      />

      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search by trainer name"
        style={styles.search}
      />

      {error ? (
        <InlineError message={error} onRetry={fetchFriends} style={styles.banner} />
      ) : null}

      {query.trim().length >= 2 ? (
        <>
          <SectionHeader title="Search results" />
          {searching ? (
            <SkeletonList count={3} />
          ) : results.length === 0 ? (
            <Text style={[text.bodySm, { color: paper.textFaint }]}>
              No trainer by that name.
            </Text>
          ) : (
            <View>
              {results.map((user, index) => (
                <Row
                  key={user.id}
                  user={user}
                  index={index}
                  onPress={() =>
                    navigation.navigate('PublicProfile', { userId: user.id })
                  }
                  action={
                    <Button
                      label="Add"
                      onPress={() => void add(user.username)}
                      variant="secondary"
                    />
                  }
                />
              ))}
            </View>
          )}
        </>
      ) : null}

      {incoming.length > 0 ? (
        <>
          <SectionHeader
            title="Requests"
            description="These need an answer from you."
          />
          <View>
            {incoming.map((user, index) => (
              <Row
                key={user.id}
                user={user}
                index={index}
                onPress={() =>
                  navigation.navigate('PublicProfile', { userId: user.id })
                }
                action={
                  <View style={styles.requestActions}>
                    <Button
                      label="Accept"
                      onPress={() => void respond(user.friendshipId, true)}
                    />
                    <Button
                      label="Decline"
                      onPress={() => void respond(user.friendshipId, false)}
                      variant="ghost"
                    />
                  </View>
                }
              />
            ))}
          </View>
        </>
      ) : null}

      <SectionHeader
        title="Your friends"
        description={friends.length > 0 ? `${friends.length} total` : undefined}
      />

      {loading ? (
        <SkeletonList count={5} />
      ) : friends.length === 0 ? (
        <EmptyState
          title="No friends yet"
          body="Search for a trainer name above. Friends can see each other's collections and share a leaderboard."
          Glyph={UsersThree}
          compact
        />
      ) : (
        <View>
          {friends.map((user, index) => (
            <Row
              key={user.id}
              user={user}
              index={index}
              onPress={() =>
                navigation.navigate('PublicProfile', { userId: user.id })
              }
            />
          ))}
        </View>
      )}

      {outgoing.length > 0 ? (
        <>
          <SectionHeader title="Waiting on them" />
          <View>
            {outgoing.map((user, index) => (
              <Row
                key={user.id}
                user={user}
                index={index}
                onPress={() =>
                  navigation.navigate('PublicProfile', { userId: user.id })
                }
                action={<Badge label="Pending" />}
              />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const Row = React.memo(function Row({
  user,
  index,
  onPress,
  action,
}: {
  user: User;
  index: number;
  onPress: () => void;
  action?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${user.username}, rank ${user.photographerRank}`}
      style={[
        styles.row,
        index > 0 && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: paper.hairline,
        },
      ]}
    >
      <Avatar name={user.username} size={40} />

      <View style={styles.rowBody}>
        <Text style={[text.body, { color: paper.text }]} numberOfLines={1}>
          {user.username}
        </Text>
        <Text style={[text.caption, { color: paper.textFaint }]}>
          {rankTitle(user.photographerRank)}
        </Text>
      </View>

      {action}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  search: {
    marginTop: spacing.xs,
  },
  banner: {
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowBody: {
    flex: 1,
    gap: 1,
  },
  requestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
});
