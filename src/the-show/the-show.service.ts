import { HttpService } from '@nestjs/axios';
import { BadGatewayException, Injectable } from '@nestjs/common';
import { GameApiResponse } from 'src/analyzer/types/analysis-result.interface';
import {
  GameHistoryApiResponse,
  GameTypeCheckRequest,
  GameTypeCheckResponse,
} from './types/game-history-api-response.interface';
import {
  PlayerSearchApiResponse,
  UserInfoApiResponse,
} from './types/user-info-api-response.interface';

@Injectable()
export class TheShowService {
  constructor(private readonly httpService: HttpService) {}

  async fetchGameLogFromApi(
    username: string,
    gameId: string,
  ): Promise<GameApiResponse> {
    const params = new URLSearchParams({
      username,
      platform: 'mlbts',
      id: gameId,
    });
    const apiUrl = `https://mlb26.theshow.com/apis/game_log.json?${params.toString()}`;

    try {
      const response = await this.httpService.axiosRef.get<unknown>(apiUrl);
      if (this.isGameApiResponse(response.data)) {
        return response.data;
      }

      const apiError = this.getApiError(response.data);
      console.warn(
        `MLB The Show game_log API 응답 오류 (${gameId}): ${apiError ?? '예상하지 못한 응답 형식'}`,
      );
    } catch (error) {
      console.warn(
        `MLB The Show game_log API 호출 실패 (${gameId}). 공식 경기 페이지로 재시도합니다.`,
        error,
      );
    }

    return this.fetchGameLogFromPage(username, gameId);
  }

  private isGameApiResponse(data: unknown): data is GameApiResponse {
    if (!data || typeof data !== 'object' || !('game' in data)) {
      return false;
    }

    const game = (data as { game?: unknown }).game;
    return (
      Array.isArray(game) &&
      game.length >= 2 &&
      Array.isArray(game[0]) &&
      game[0][0] === 'line_score' &&
      Array.isArray(game[1]) &&
      game[1][0] === 'game_log' &&
      typeof game[1][1] === 'string'
    );
  }

  private getApiError(data: unknown): string | undefined {
    if (
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof data.error === 'string'
    ) {
      return data.error;
    }
    return undefined;
  }

  private async fetchGameLogFromPage(
    username: string,
    gameId: string,
  ): Promise<GameApiResponse> {
    const params = new URLSearchParams({
      platform: 'mlbts',
      username,
    });
    const pageUrl = `https://mlb26.theshow.com/games/${encodeURIComponent(gameId)}?${params.toString()}`;

    try {
      const response = await this.httpService.axiosRef.get<string>(pageUrl, {
        responseType: 'text',
      });
      return this.parseGamePage(response.data, gameId);
    } catch (error) {
      console.error(
        `MLB The Show 경기 상세 페이지 처리 실패 (${gameId}):`,
        error,
      );
      throw new BadGatewayException(
        'MLB The Show에서 경기 상세 기록을 가져오지 못했습니다.',
      );
    }
  }

  private parseGamePage(html: string, gameId: string): GameApiResponse {
    const summaryTableMatch = html.match(
      /<div class=['"]well['"]>[\s\S]*?<\/div>\s*<table>([\s\S]*?)<\/table>/i,
    );
    const gameLogMatch = html.match(
      /<h3>\s*Game Log\s*<\/h3>([\s\S]*?)<\/div>/i,
    );

    if (!summaryTableMatch || !gameLogMatch) {
      throw new Error(`경기 ${gameId}의 라인스코어 또는 게임 로그가 없습니다.`);
    }

    const tableHtml = summaryTableMatch[1];
    const innings = [...tableHtml.matchAll(/<th>\s*(\d+)\s*<\/th>/gi)].map(
      (match) => match[1],
    );
    const rows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)]
      .map((match) =>
        [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
          this.htmlToText(cell[1]),
        ),
      )
      .filter(
        (cells) =>
          cells.length >= 7 &&
          Boolean(cells[1]) &&
          Boolean(cells[2]) &&
          ['W', 'L'].includes(cells[3]),
      );

    if (rows.length < 2) {
      throw new Error(`경기 ${gameId}의 라인스코어 형식을 해석할 수 없습니다.`);
    }

    const [awayRow, homeRow] = rows;
    const buildTeam = (row: string[]) => ({
      fullName: row[1],
      playerName: row[2],
      result: row[3],
      runs: row.at(-3) ?? '0',
      hits: row.at(-2) ?? '0',
    });
    const away = buildTeam(awayRow);
    const home = buildTeam(homeRow);
    const gameLog = gameLogMatch[1]
      .replace(/<br\s*\/?>/gi, '^n')
      .replace(/<[^>]+>/g, '')
      .trim()
      .replace(
        /(^|\^n)(?=[A-Za-z][A-Za-z\s.'-]+ batting\.)/g,
        '$1^',
      );

    if (!gameLog) {
      throw new Error(`경기 ${gameId}의 게임 로그가 비어 있습니다.`);
    }

    return {
      game: [
        [
          'line_score',
          {
            inning: innings.at(-1) ?? '',
            innings: String(innings.length),
            home_full_name: home.fullName,
            away_full_name: away.fullName,
            home_name: home.playerName,
            away_name: away.playerName,
            home_runs: home.runs,
            away_runs: away.runs,
            home_hits: home.hits,
            away_hits: away.hits,
            home_display_result: home.result,
            away_display_result: away.result,
            game_mode: '',
            game_uuid: gameId,
          },
        ],
        ['game_log', this.decodeHtmlEntities(gameLog)],
        ['box_score', []],
      ],
    };
  }

  private htmlToText(html: string): string {
    return this.decodeHtmlEntities(
      html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    );
  }

  private decodeHtmlEntities(value: string): string {
    const namedEntities: Record<string, string> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: ' ',
      quot: '"',
    };

    return value.replace(
      /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
      (entity, code: string) => {
        if (code.startsWith('#x')) {
          return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
        }
        if (code.startsWith('#')) {
          return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
        }
        return namedEntities[code.toLowerCase()] ?? entity;
      },
    );
  }

  // 팀원 닉네임으로 게임 조회 (2:2 게임 판단용)
  async checkTeammateGame(
    teammateUsername: string,
    gameId: string,
  ): Promise<boolean> {
    try {
      const url = `https://mlb26.theshow.com/apis/game_log.json?username=${teammateUsername}&id=${gameId}`;
      const response = await this.httpService.axiosRef.get(url);

      // HTML 에러 페이지가 아닌 실제 JSON 데이터인지 확인
      const headers = response.headers;
      const contentType =
        typeof headers === 'object' &&
        headers &&
        'content-type' in headers &&
        typeof headers['content-type'] === 'string'
          ? headers['content-type']
          : '';

      let dataStr = '';
      try {
        dataStr =
          typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data);
      } catch {
        dataStr = '';
      }

      // HTML 에러 페이지는 content-type이 text/html이거나 <!doctype html>을 포함
      const isHtmlError =
        contentType.includes('text/html') ||
        dataStr.includes('<!doctype html>');

      // 실제 게임 데이터는 JSON이고 "game" 배열을 포함
      const hasGameData = !isHtmlError && dataStr.includes('"game":[');

      return hasGameData;
    } catch {
      return false; // 조회 실패 = 1:1 게임 또는 잘못된 정보
    }
  }

  async fetchGameHistoryFromApi(
    username: string,
    page?: number,
  ): Promise<GameHistoryApiResponse> {
    const url = `https://mlb26.theshow.com/apis/game_history.json?username=${username}&page=${page}`;
    const response = await this.httpService.axiosRef.get(url);
    const gameHistoryData = response.data as GameHistoryApiResponse;

    // CPU 게임 여부 체크와 팀 이름 추출
    const enhancedGameHistory = gameHistoryData.game_history.map((game) => {
      // CPU 게임 체크 (싱글게임) - home_full_name, away_full_name에서 체크
      const isSingleGame =
        game.home_full_name === 'CPU' || game.away_full_name === 'CPU';

      // 플레이어 팀 이름 추출 로직
      let teamName: string | undefined;

      // 첫 번째 케이스: home_name과 away_name이 모두 CPU일 경우
      if (game.home_name === 'CPU' && game.away_name === 'CPU') {
        // home_full_name과 away_full_name 중 CPU가 아닌 이름을 팀 이름으로 판단
        if (game.home_full_name !== 'CPU') {
          teamName = game.home_full_name;
        } else if (game.away_full_name !== 'CPU') {
          teamName = game.away_full_name;
        }
      }
      // 두 번째 케이스: home_name 또는 away_name 중 하나만 CPU일 경우
      else if (game.home_name === 'CPU' && game.away_name !== 'CPU') {
        // home 쪽이 CPU이므로 home_full_name을 팀 이름으로 판단
        teamName = game.home_full_name;
      } else if (game.home_name !== 'CPU' && game.away_name === 'CPU') {
        // away 쪽이 CPU이므로 away_full_name을 팀 이름으로 판단
        teamName = game.away_full_name;
      }

      return {
        ...game,
        teamName,
        isSingleGame,
      };
    });

    return {
      ...gameHistoryData,
      game_history: enhancedGameHistory,
    };
  }

  // 게임 타입 체크 API (단일 게임 처리)
  async checkGameType(
    request: GameTypeCheckRequest,
  ): Promise<GameTypeCheckResponse> {
    console.log('🔍 받은 요청:', JSON.stringify(request, null, 2));

    const { gameId, teammateUsername } = request;

    if (!gameId) {
      throw new Error('gameId가 필요합니다.');
    }

    if (!teammateUsername) {
      throw new Error('teammateUsername이 필요합니다.');
    }

    // 호스트인 게임이므로 id+2로 팀원 게임 조회
    const teammateGameId = (parseInt(gameId) + 2).toString();
    const isTeamGame = await this.checkTeammateGame(
      teammateUsername,
      teammateGameId,
    );

    console.log(`🔄 게임 ${gameId} 체크 완료: ${isTeamGame ? '2:2' : '1:1'}`);

    return {
      gameId,
      isTeamGame,
    };
  }

  async fetchIconImageUrl(username: string): Promise<string | null> {
    const url = `https://mlb26.theshow.com/universal_profiles/mlbts/${username}`;

    try {
      const res = await fetch(url);
      const html = await res.text();

      // 정규표현식으로 <img class="img-responsive" src="..."> 추출
      const match = html.match(
        /<img[^>]+class="img-responsive"[^>]+src="([^"]+)"/,
      );

      return match?.[1] ?? null;
    } catch (error) {
      console.error('아이콘 이미지 추출 실패:', error);
      return null;
    }
  }

  async fetchUserInfoFromApi(username: string): Promise<UserInfoApiResponse> {
    // 1. player_search API 호출
    const playerSearchUrl = `https://mlb26.theshow.com/apis/player_search.json?username=${username}`;
    const playerResponse = await this.httpService.axiosRef.get(playerSearchUrl);

    // 2. 아이콘 이미지 URL 가져오기
    const iconImageUrl = await this.fetchIconImageUrl(username);

    // 3. 두 데이터를 합쳐서 응답
    return {
      playerInfo: playerResponse.data as PlayerSearchApiResponse,
      iconImageUrl: iconImageUrl,
    };
  }
}
