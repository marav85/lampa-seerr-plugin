(function () {
    'use strict';

    if (window.plugin_seerr_upcoming_ready) return;
    window.plugin_seerr_upcoming_ready = true;

    const PLUGIN_NAME = 'Seerr Upcoming';
    const PLUGIN_ID = 'seerr_upcoming';

    const SESSION_CACHE = {
        data: {},
        state: null
    };
    const CACHE_TTL = 10 * 60 * 1000;

    const MENU_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path></svg>`;

    const TYPES = {
        movie: 'Фильмы',
        tv: 'Сериалы (новые)',
        tv_upcoming: 'Сериалы: новые сезоны'
    };

    const GENRES = {
        all: 'Все жанры', 28: 'Боевик', 12: 'Приключения', 16: 'Мультфильм',
        35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма',
        10751: 'Семейный', 14: 'Фэнтези', 36: 'История', 27: 'Ужасы',
        10402: 'Музыка', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика',
        53: 'Триллер', 10752: 'Военный', 37: 'Вестерн',
        10759: 'Экшн/Приключения', 10762: 'Детский', 10763: 'Новости',
        10764: 'Реалити', 10765: 'Фантастика/Фэнтези', 10766: 'Мыльная опера',
        10767: 'Ток-шоу', 10768: 'Война и политика'
    };

    const LANGS = {
        all: 'Все страны',
        en: 'США / Британия (EN)',
        ru: 'Россия (RU)',
        ko: 'Корея (KO)',
        ja: 'Япония (JA)',
        fr: 'Франция (FR)',
        de: 'Германия (DE)',
        es: 'Испания (ES)'
    };

    const SORTS = {
        'popularity.desc': 'Популярные',
        'release_date.asc': 'Ближайшие',
        'release_date.desc': 'Дальние',
        'vote_average.desc': 'По рейтингу',
        'vote_count.desc': 'По оценкам',
        'original_title.asc': 'По названию'
    };

    function getYearsList() {
        const currentYear = new Date().getFullYear();
        const years = { all: 'Все годы' };
        for (let y = currentYear + 3; y >= currentYear; y--) {
            years[y.toString()] = y.toString();
        }
        return years;
    }

    function hasCyrillic(text) {
        return text && /[а-яА-ЯёЁ]/.test(text);
    }

    function SeerrCatalogComponent(object) {
        const network = new Lampa.Reguest();
        const scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        const html = $('<div class="seerr-catalog"></div>');
        const body = $('<div class="category-full"></div>');
        
        let items = [];
        let active = false;
        let last_focused_index = 0;
        let page = 1;
        let total_pages = 1;
        let loading = false;
        let loaded_pages = {};
        let min_cards_buffer = 40;

        let filters = SESSION_CACHE.state ? Object.assign({}, SESSION_CACHE.state.filters) : {
            type: 'movie',
            genre: 'all',
            year: 'all',
            sort: 'popularity.desc',
            lang: 'all',
            search: ''
        };

        this.create = function () {
            this.renderHeader();
            scroll.append(body);
            html.append(scroll.render());
            scroll.minus();

            scroll.onScroll = (y) => {
                const el = scroll.render().get(0);
                if (el) {
                    const maxScroll = el.scrollHeight - el.clientHeight;
                    if (maxScroll > 0 && (maxScroll - y) < 800) {
                        this.loadNextPage();
                    }
                }
            };

            scroll.onEnd = () => {
                this.loadNextPage();
            };

            if (SESSION_CACHE.state && SESSION_CACHE.state.itemsData.length > 0) {
                page = SESSION_CACHE.state.page;
                total_pages = SESSION_CACHE.state.total_pages;
                last_focused_index = SESSION_CACHE.state.last_focused_index || 0;
                loaded_pages = Object.assign({}, SESSION_CACHE.state.loaded_pages || {});
                this.buildCards(SESSION_CACHE.state.itemsData);
                this.start();
            } else {
                this.activity.loader(true);
                this.loadData(false);
            }

            return this.render();
        };

        this.loadNextPage = function () {
            if (!loading && page < total_pages) {
                const nextPage = page + 1;
                if (!loaded_pages[nextPage]) {
                    page = nextPage;
                    this.loadData(true);
                }
            }
        };

        this.renderHeader = function () {
            const yearsList = getYearsList();
            const isUpcomingFeed = filters.type === 'tv_upcoming' && !filters.search;
            const extraDisplay = isUpcomingFeed ? 'none' : 'inline-flex';
            const sortDisplay = (isUpcomingFeed || filters.search) ? 'none' : 'inline-flex';
            const searchLabel = filters.search ? `Поиск: ${filters.search}` : 'Поиск';

            const btnStyle = 'margin: 0; display: inline-flex; align-items: center;';
            const extraStyle = `margin: 0; display: ${extraDisplay}; align-items: center;`;
            const sortStyle = `margin: 0; display: ${sortDisplay}; align-items: center;`;

            const header = $(`
                <div class="seerr-filter-bar" style="padding: 1.5em 1.5em 0.5em 1.5em; display: flex; align-items: center; gap: 0.8em; flex-wrap: wrap;">
                    <div class="simple-button selector filter-search" style="${btnStyle}">${searchLabel}</div>
                    <div class="simple-button selector filter-type" style="${btnStyle}">Тип: ${TYPES[filters.type] || 'Фильмы'}</div>
                    <div class="simple-button selector filter-genre" style="${extraStyle}">Жанр: ${GENRES[filters.genre] || 'Все жанры'}</div>
                    <div class="simple-button selector filter-year" style="${extraStyle}">Год: ${yearsList[filters.year] || 'Все годы'}</div>
                    <div class="simple-button selector filter-sort" style="${sortStyle}">Сортировка: ${SORTS[filters.sort] || 'Популярные'}</div>
                    <div class="simple-button selector filter-lang" style="${extraStyle}">Язык: ${LANGS[filters.lang] || 'Все страны'}</div>
                </div>
            `);

            header.find('.filter-search').on('hover:enter', () => {
                Lampa.Input.edit({
                    title: 'Поиск (оставьте пустым для сброса)',
                    value: filters.search || '',
                    free: true,
                    nosave: true
                }, (newValue) => {
                    filters.search = (newValue || '').trim();
                    header.find('.filter-search').text(filters.search ? `Поиск: ${filters.search}` : 'Поиск');
                    this.updateFilterVisibility();
                    this.resetAndReload();
                    Lampa.Controller.toggle('content');
                });
            });

            header.find('.filter-type').on('hover:enter', () => this.openSelect('Тип контента', TYPES, 'type', '.filter-type', 'Тип: '));
            header.find('.filter-genre').on('hover:enter', () => this.openSelect('Выберите жанр', GENRES, 'genre', '.filter-genre', 'Жанр: '));
            header.find('.filter-year').on('hover:enter', () => this.openSelect('Год релиза', yearsList, 'year', '.filter-year', 'Год: '));
            header.find('.filter-sort').on('hover:enter', () => this.openSelect('Сортировка', SORTS, 'sort', '.filter-sort', 'Сортировка: '));
            header.find('.filter-lang').on('hover:enter', () => this.openSelect('Страна / Оригинал', LANGS, 'lang', '.filter-lang', 'Язык: '));

            scroll.append(header);
        };

        this.updateFilterVisibility = function () {
            const isSearch = Boolean(filters.search);
            const isUpcomingFeed = filters.type === 'tv_upcoming' && !isSearch;

            const extraBtns = html.find('.filter-genre, .filter-year, .filter-lang');
            const sortBtn = html.find('.filter-sort');

            if (isUpcomingFeed) {
                extraBtns.css('display', 'none');
                sortBtn.css('display', 'none');
            } else {
                extraBtns.css('display', 'inline-flex');
                sortBtn.css('display', isSearch ? 'none' : 'inline-flex');
            }
        };

        this.openSelect = function (title, listObj, filterKey, btnSelector, prefix) {
            const selectItems = Object.keys(listObj).map(key => ({
                title: listObj[key],
                value: key,
                selected: filters[filterKey] === key
            }));

            Lampa.Select.show({
                title: title,
                items: selectItems,
                onSelect: (selected) => {
                    filters[filterKey] = selected.value;
                    html.find(btnSelector).text(prefix + selected.title);
                    if (filterKey === 'type') {
                        this.updateFilterVisibility();
                    }
                    this.resetAndReload();
                },
                onBack: () => {
                    Lampa.Controller.toggle('content');
                }
            });
        };

        this.resetAndReload = function () {
            page = 1;
            items = [];
            loaded_pages = {};
            last_focused_index = 0;
            SESSION_CACHE.state = null;
            body.empty();
            scroll.reset();
            this.activity.loader(true);
            this.loadData(false);
        };

        this.buildUrl = function (targetPage) {
            const domain = Lampa.Storage.get('seerr_url', '').replace(/\/+$/, '');

            // Режим поиска по запросу пользователя
            if (filters.search) {
                return `${domain}/api/v1/search?query=${encodeURIComponent(filters.search)}&page=${targetPage}`;
            }

            // Лента новых сезонов и серий
            if (filters.type === 'tv_upcoming') {
                return `${domain}/api/v1/discover/tv/upcoming?page=${targetPage}`;
            }

            const today = new Date().toISOString().slice(0, 10);
            const isMovie = filters.type === 'movie';
            const endpoint = isMovie ? '/api/v1/discover/movies' : '/api/v1/discover/tv';
            
            let sortValue = filters.sort;
            if (sortValue === 'release_date.asc') {
                sortValue = isMovie ? 'primary_release_date.asc' : 'first_air_date.asc';
            } else if (sortValue === 'release_date.desc') {
                sortValue = isMovie ? 'primary_release_date.desc' : 'first_air_date.desc';
            } else if (sortValue === 'original_title.asc') {
                sortValue = isMovie ? 'original_title.asc' : 'original_name.asc';
            }

            let params = [
                `page=${targetPage}`,
                `sortBy=${encodeURIComponent(sortValue)}`
            ];

            if (filters.lang !== 'all') {
                params.push(`language=${encodeURIComponent(filters.lang)}`);
            }

            const dateGteKey = isMovie ? 'primaryReleaseDateGte' : 'firstAirDateGte';
            const dateLteKey = isMovie ? 'primaryReleaseDateLte' : 'firstAirDateLte';

            if (filters.year === 'all') {
                params.push(`${dateGteKey}=${encodeURIComponent(today)}`);
            } else {
                const startDate = (filters.year === today.slice(0, 4)) ? today : `${filters.year}-01-01`;
                params.push(`${dateGteKey}=${encodeURIComponent(startDate)}`);
                params.push(`${dateLteKey}=${encodeURIComponent(filters.year + '-12-31')}`);
            }

            if (filters.genre !== 'all') {
                params.push(`genre=${encodeURIComponent(filters.genre)}`);
            }

            return `${domain}${endpoint}?${params.join('&')}`;
        };

        this.loadData = function (append) {
            const domain = Lampa.Storage.get('seerr_url', '').replace(/\/+$/, '');
            const apiKey = Lampa.Storage.get('seerr_api_key', '');

            if (!domain || !apiKey) {
                this.activity.loader(false);
                Lampa.Noty.show('Укажите URL сервера и API Key в настройках Lampa -> Seerr');
                return;
            }

            const currentPage = page;
            const url = this.buildUrl(currentPage);

            const cached = SESSION_CACHE.data[url];
            if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
                this.activity.loader(false);
                total_pages = cached.totalPages;
                loaded_pages[currentPage] = true;
                this.handleResults(cached.results, append, currentPage);
                return;
            }

            loading = true;
            network.clear();
            network.timeout(10000);
            network.native(url, (json) => {
                loading = false;
                this.activity.loader(false);

                if (json && json.results && json.results.length > 0) {
                    total_pages = json.totalPages || 1;
                    loaded_pages[currentPage] = true;
                    SESSION_CACHE.data[url] = {
                        results: json.results,
                        totalPages: total_pages,
                        timestamp: Date.now()
                    };
                    this.handleResults(json.results, append, currentPage);
                } else if (!append) {
                    body.append('<div class="empty__title" style="padding: 2em;">Ничего не найдено</div>');
                    this.start();
                }
            }, (error) => {
                loading = false;
                this.activity.loader(false);
                Lampa.Noty.show('Ошибка API Seerr: ' + (error.status || 'Сетевая ошибка'));
                if (!append) this.start();
            }, false, {
                headers: {
                    'X-Api-Key': apiKey,
                    'Accept': 'application/json'
                }
            });
        };
        this.filterResults = function (rawResults) {
            const hideNoPoster = Lampa.Storage.get('seerr_hide_no_poster', true);
            const onlyRu = Lampa.Storage.get('seerr_only_ru', false);
            const today = new Date().toISOString().slice(0, 10);
            const isSearch = Boolean(filters.search);
            const expectedMediaType = filters.type === 'movie' ? 'movie' : 'tv';

            return rawResults.filter((el) => {
                if (isSearch) {
                    if (el.mediaType && el.mediaType !== expectedMediaType) return false;

                    if (filters.genre !== 'all') {
                        if (!Array.isArray(el.genreIds) || !el.genreIds.includes(Number(filters.genre))) {
                            return false;
                        }
                    }

                    if (filters.lang !== 'all') {
                        if (el.originalLanguage !== filters.lang) return false;
                    }

                    const relDate = el.releaseDate || el.firstAirDate || '';
                    if (filters.type !== 'tv_upcoming') {
                        if (filters.year === 'all') {
                            if (relDate && relDate < today) return false;
                        } else {
                            if (!relDate || !relDate.startsWith(filters.year)) return false;
                            if (filters.year === today.slice(0, 4) && relDate < today) return false;
                        }
                    }
                } else {
                    if (filters.type === 'movie') {
                        const relDate = el.releaseDate || '';
                        if (relDate && relDate < today) return false;
                    }
                }

                if (hideNoPoster && !el.posterPath) return false;

                if (onlyRu && filters.type !== 'tv_upcoming') {
                    const title = el.title || el.name || '';
                    const overview = el.overview || '';
                    if (!hasCyrillic(title) && !hasCyrillic(overview)) return false;
                }

                return true;
            });
        };

        this.handleResults = function (rawResults, append, currentPage) {
            const filtered = this.filterResults(rawResults);

            // Если это поиск в режиме "Новые сезоны", проверяем статус каждого сериала через /api/v1/tv/{id},
            // чтобы отсеять завершенные шоу (Ended / Canceled)
            if (filters.search && filters.type === 'tv_upcoming' && filtered.length > 0) {
                const domain = Lampa.Storage.get('seerr_url', '').replace(/\/+$/, '');
                const apiKey = Lampa.Storage.get('seerr_api_key', '');
                let checkedCount = 0;
                const activeSeries = [];

                filtered.forEach((item) => {
                    const tvReq = new Lampa.Reguest();
                    tvReq.native(`${domain}/api/v1/tv/${item.id}`, (details) => {
                        checkedCount++;
                        const isOngoing = details && (
                            details.nextEpisodeToAir ||
                            ['Returning Series', 'In Production', 'Planned'].includes(details.status)
                        );
                        if (isOngoing) activeSeries.push(item);

                        if (checkedCount === filtered.length) {
                            this.applyFilteredResults(activeSeries, append, currentPage);
                        }
                    }, () => {
                        checkedCount++;
                        if (checkedCount === filtered.length) {
                            this.applyFilteredResults(activeSeries, append, currentPage);
                        }
                    }, false, {
                        headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json' }
                    });
                });
                return;
            }

            this.applyFilteredResults(filtered, append, currentPage);
        };

        this.applyFilteredResults = function (filtered, append, currentPage) {
            if (!SESSION_CACHE.state || !append) {
                SESSION_CACHE.state = {
                    filters: Object.assign({}, filters),
                    page: currentPage,
                    total_pages: total_pages,
                    last_focused_index: 0,
                    loaded_pages: Object.assign({}, loaded_pages),
                    itemsData: []
                };
            }
            SESSION_CACHE.state.page = currentPage;
            SESSION_CACHE.state.loaded_pages = Object.assign({}, loaded_pages);
            SESSION_CACHE.state.itemsData = SESSION_CACHE.state.itemsData.concat(filtered);

            this.buildCards(filtered);
            if (!append) this.start();

            if (items.length < min_cards_buffer && currentPage < total_pages) {
                setTimeout(() => this.loadNextPage(), 120);
            } else if (items.length === 0 && currentPage >= total_pages) {
                body.append('<div class="empty__title" style="padding: 2em;">По заданным фильтрам ничего не найдено</div>');
            }
        };

        this.fetchTvSeasonInfo = function (tvId, cardEl) {
            const domain = Lampa.Storage.get('seerr_url', '').replace(/\/+$/, '');
            const apiKey = Lampa.Storage.get('seerr_api_key', '');
            if (!SESSION_CACHE.tvDetails) SESSION_CACHE.tvDetails = {};

            const renderBadge = (details) => {
                if (!details || !Array.isArray(details.seasons)) return;

                const regularSeasons = details.seasons.filter(s => s.seasonNumber > 0);
                if (regularSeasons.length === 0) return;

                let targetSeasonNum = null;
                if (details.nextEpisodeToAir && details.nextEpisodeToAir.seasonNumber > 0) {
                    targetSeasonNum = details.nextEpisodeToAir.seasonNumber;
                } else {
                    targetSeasonNum = regularSeasons.at(-1).seasonNumber;
                }

                const seasonObj = regularSeasons.find(s => s.seasonNumber === targetSeasonNum) || regularSeasons.at(-1);
                if (!seasonObj) return;

                const totalEps = seasonObj.episodeCount || 0;
                const today = new Date().toISOString().slice(0, 10);
                let airedEps = 0;

                if (seasonObj.airDate && seasonObj.airDate > today) {
                    airedEps = 0;
                } else if (details.nextEpisodeToAir && details.nextEpisodeToAir.seasonNumber === seasonObj.seasonNumber) {
                    airedEps = Math.max(0, (details.nextEpisodeToAir.episodeNumber || 1) - 1);
                } else if (details.lastEpisodeToAir && details.lastEpisodeToAir.seasonNumber === seasonObj.seasonNumber) {
                    airedEps = details.lastEpisodeToAir.episodeNumber || totalEps;
                } else if (seasonObj.airDate && seasonObj.airDate <= today) {
                    airedEps = totalEps;
                }

                const epText = totalEps > 0 ? `${airedEps} из ${totalEps}` : `${airedEps} сер.`;
                const badgeText = `S${seasonObj.seasonNumber} • ${epText}`;

                cardEl.find('.card__view').append(
                    `<div class="seerr-season-badge" style="background: rgba(0, 0, 0, 0.78); color: #fff; font-size: 0.85em; padding: 0.25em 0.5em; border-radius: 0.3em; position: absolute; bottom: 0.5em; left: 0.5em; z-index: 2;">${badgeText}</div>`
                );
            };

            if (SESSION_CACHE.tvDetails[tvId]) {
                renderBadge(SESSION_CACHE.tvDetails[tvId]);
                return;
            }

            const req = new Lampa.Reguest();
            req.native(`${domain}/api/v1/tv/${tvId}`, (details) => {
                if (details) {
                    SESSION_CACHE.tvDetails[tvId] = details;
                    renderBadge(details);
                }
            }, () => {}, false, {
                headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json' }
            });
        };

        this.buildCards = function (results) {
            const mediaMethod = filters.type === 'movie' ? 'movie' : 'tv';
            const showGenres = Lampa.Storage.get('seerr_show_genres', true);
            const showSeasons = Lampa.Storage.get('seerr_show_seasons', true);
            const showRating = Lampa.Storage.get('seerr_show_rating', true);

            results.forEach((element) => {
                const currentIndex = items.length;
                const cardData = {
                    id: element.id,
                    title: element.title || element.name,
                    original_title: element.originalTitle || element.originalName,
                    release_date: element.releaseDate || element.firstAirDate || '',
                    poster_path: element.posterPath,
                    backdrop_path: element.backdropPath,
                    vote_average: element.voteAverage || 0,
                    overview: element.overview,
                    source: 'tmdb',
                    media_type: mediaMethod
                };

                const card = Lampa.Template.get('card', {
                    title: cardData.title,
                    release_year: cardData.release_date ? cardData.release_date.slice(0, 4) : 'Скоро'
                });

                // 1. Рейтинг (левый верхний угол постера, если включено в настройках и оценка > 0)
                if (showRating && cardData.vote_average > 0) {
                    const ratingVal = Number(cardData.vote_average).toFixed(1);
                    const ratingColor = ratingVal >= 7 ? '#2ecc71' : (ratingVal >= 5 ? '#f39c12' : '#e74c3c');
                    card.find('.card__view').append(
                        `<div class="seerr-rating-badge" style="background: rgba(0, 0, 0, 0.78); color: ${ratingColor}; font-weight: 700; font-size: 0.85em; padding: 0.25em 0.5em; border-radius: 0.3em; position: absolute; top: 0.5em; left: 0.5em; z-index: 2;">★ ${ratingVal}</div>`
                    );
                }

                // 2. Жанры под названием карточки (если включено в настройках)
                if (showGenres && Array.isArray(element.genreIds) && element.genreIds.length > 0) {
                    const genreNames = element.genreIds
                        .map(id => GENRES[id])
                        .filter(Boolean)
                        .slice(0, 2);

                    if (genreNames.length > 0) {
                        card.find('.card__title').after(
                            `<div class="seerr-card-genres" style="font-size: 0.8em; color: rgba(255,255,255,0.6); margin-top: 0.25em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${genreNames.join(', ')}</div>`
                        );
                    }
                }

                // 3. Статус запроса в Seerr (правый верхний угол)
                if (element.mediaInfo && element.mediaInfo.status) {
                    const statusMap = {
                        2: { text: 'Запрошено', color: '#e67e22' },
                        3: { text: 'Обработка', color: '#3498db' },
                        4: { text: 'Частично', color: '#9b59b6' },
                        5: { text: 'Доступно', color: '#2ecc71' }
                    };
                    const st = statusMap[element.mediaInfo.status];
                    if (st) {
                        card.find('.card__view').append(
                            `<div class="card__quality" style="background: ${st.color}; color: #fff;">${st.text}</div>`
                        );
                    }
                }

                // 4. Номер сезона и серии для сериалов (левый нижний угол, если включено в настройках)
                if (showSeasons && mediaMethod === 'tv') {
                    this.fetchTvSeasonInfo(cardData.id, card);
                }

                const img = card.find('.card__img');
                if (cardData.poster_path) {
                    const posterUrl = Lampa.TMDB.image('t/p/w300' + cardData.poster_path);
                    img.attr('src', posterUrl);
                    const preloader = new Image();
                    preloader.src = posterUrl;
                } else {
                    img.attr('src', './img/img_broken.svg');
                }

                card.on('hover:focus', () => {
                    last_focused_index = currentIndex;
                    if (SESSION_CACHE.state) SESSION_CACHE.state.last_focused_index = currentIndex;
                    scroll.update(card, true);

                    if (items.length - currentIndex <= 15) {
                        this.loadNextPage();
                    }
                });

                card.on('hover:enter', () => {
                    Lampa.Activity.push({
                        url: '',
                        component: 'full',
                        id: cardData.id,
                        method: mediaMethod,
                        card: cardData,
                        source: 'tmdb'
                    });
                });

                body.append(card);
                items.push(card);
            });

            if (active) Lampa.Controller.collectionSet(scroll.render());
        };

        this.start = function () {
            active = true;
            Lampa.Controller.add('content', {
                toggle: () => {
                    Lampa.Controller.collectionSet(scroll.render());
                    const targetCard = items.at(last_focused_index) || false;
                    Lampa.Controller.collectionFocus(targetCard, scroll.render());
                },
                left: () => {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: () => Navigator.move('right'),
                up: () => {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: () => Navigator.move('down'),
                back: () => {
                    SESSION_CACHE.state = null;
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () { active = false; };
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            network.clear();
            scroll.destroy();
            html.remove();
        };
    }

    function initPlugin() {
        Lampa.Component.add(PLUGIN_ID, SeerrCatalogComponent);

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: PLUGIN_NAME,
            icon: MENU_ICON
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_url', type: 'input', values: '', default: 'https://example.com' },
            field: { name: 'URL сервера Seerr', description: 'Например: https://mydomain.ru (без слеша в конце)' }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_api_key', type: 'input', values: '', default: '' },
            field: { name: 'API Key', description: 'Ключ из настроек Seerr (Settings -> General -> API Key)' }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_hide_no_poster', type: 'trigger', default: true },
            field: { name: 'Скрывать без постера', description: 'Не показывать анонсы, у которых еще нет обложки' }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_only_ru', type: 'trigger', default: false },
            field: { name: 'Только с русским переводом', description: 'Показывать только релизы с русским названием или описанием' }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_show_genres', type: 'trigger', default: true },
            field: { name: 'Показывать жанры', description: 'Выводить названия жанров под заголовком карточки' }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_show_seasons', type: 'trigger', default: true },
            field: { name: 'Показывать сезон и серии', description: 'Отображать номер сезона и количество вышедших серий для сериалов' }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_show_rating', type: 'trigger', default: true },
            field: { name: 'Показывать рейтинг', description: 'Выводить оценку TMDB в углу постера (если она уже есть)' }
        });


        const menuItem = $(`
            <li class="menu__item selector" data-action="${PLUGIN_ID}">
                <div class="menu__ico">${MENU_ICON}</div>
                <div class="menu__text">${PLUGIN_NAME}</div>
            </li>
        `);

        menuItem.on('hover:enter', () => {
            SESSION_CACHE.state = null;
            Lampa.Activity.push({ url: '', title: PLUGIN_NAME, component: PLUGIN_ID, page: 1 });
        });

        $('.menu .menu__list').eq(0).append(menuItem);
    }

    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') initPlugin();
        });
    }
})();