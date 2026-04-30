import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
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
    const url = `https://mlb26.theshow.com/apis/game_log.json?username=${username}&id=${gameId}`;
    const response = await this.httpService.axiosRef.get(url);
    return response.data as GameApiResponse;
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
