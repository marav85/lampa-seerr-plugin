(function () {
    'use strict';

    if (window.plugin_seerr_upcoming_ready) return;
    window.plugin_seerr_upcoming_ready = true;

    const PLUGIN_NAME = 'Seerr Upcoming';
    const PLUGIN_ID = 'seerr_upcoming';

    const SESSION_CACHE = {
        data: {},
        tvDetails: {},
        state: null
    };
    const CACHE_TTL = 10 * 60 * 1000;

    const HISTORY_KEY = 'seerr_search_history';
    const MAX_HISTORY = 5;

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

    const RATINGS = {
        all: 'Все оценки',
        '5': 'От 5.0+',
        '6': 'От 6.0+',
        '7': 'От 7.0+',
        '7.5': 'От 7.5+',
        '8': 'От 8.0+',
        '8.5': 'От 8.5+'
    };

    const SORTS = {
        'popularity.desc': 'Популярные',
        'next_episode.asc': 'Ближайшая серия',
        'release_date.asc': 'Ближайший релиз',
        'release_date.desc': 'Дальний релиз',
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

    function getSearchHistory() {
        const list = Lampa.Storage.get(HISTORY_KEY, []);
        return Array.isArray(list) ? list : [];
    }

    function saveSearchHistory(query) {
        if (!query) return;
        let list = getSearchHistory().filter(item => item.toLowerCase() !== query.toLowerCase());
        list.unshift(query);
        if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);
        Lampa.Storage.set(HISTORY_KEY, list);
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
        let loaded_pages = {};
        let min_cards_buffer = 40;

        let filters = SESSION_CACHE.state ? Object.assign({}, SESSION_CACHE.state.filters) : {
            type: 'movie',
            genre: 'all',
            year: 'all',
            yearFrom: '',
            yearTo: '',
            rating: 'all',
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
                loaded_pages = { 1: true };
                this.loadData(false);
            }

            return this.render();
        };

        this.loadNextPage = function () {
            if (page < total_pages) {
                const nextPage = page + 1;
                if (!loaded_pages[nextPage]) {
                    loaded_pages[nextPage] = true;
                    page = nextPage;
                    this.loadData(true);
                }
            }
        };

        this.renderHeader = function () {
            const yearsList = getYearsList();
            const isSearch = Boolean(filters.search);
            const sortDisplay = isSearch ? 'none' : 'inline-flex';
            const searchLabel = filters.search ? `Поиск: ${filters.search}` : 'Поиск';

            const getYearButtonText = () => {
                if (filters.year === 'range' && (filters.yearFrom || filters.yearTo)) {
                    const fromTxt = filters.yearFrom || '...';
                    const toTxt = filters.yearTo || '...';
                    return `Год: ${fromTxt}–${toTxt}`;
                }
                return `Год: ${yearsList[filters.year] || 'Все годы'}`;
            };

            const btnStyle = 'margin: 0; display: inline-flex; align-items: center;';
            const sortStyle = `margin: 0; display: ${sortDisplay}; align-items: center;`;

            const header = $(`
                <div class="seerr-filter-bar" style="padding: 1.5em 1.5em 0.5em 1.5em; display: flex; align-items: center; gap: 0.7em; flex-wrap: wrap;">
                    <div class="simple-button selector filter-search" style="${btnStyle}">${searchLabel}</div>
                    <div class="simple-button selector filter-type" style="${btnStyle}">Тип: ${TYPES[filters.type] || 'Фильмы'}</div>
                    <div class="simple-button selector filter-genre" style="${btnStyle}">Жанр: ${GENRES[filters.genre] || 'Все жанры'}</div>
                    <div class="simple-button selector filter-year" style="${btnStyle}">${getYearButtonText()}</div>
                    <div class="simple-button selector filter-rating" style="${btnStyle}">Оценка: ${RATINGS[filters.rating] || 'Все оценки'}</div>
                    <div class="simple-button selector filter-sort" style="${sortStyle}">Сортировка: ${SORTS[filters.sort] || 'Популярные'}</div>
                    <div class="simple-button selector filter-lang" style="${btnStyle}">Язык: ${LANGS[filters.lang] || 'Все страны'}</div>
                </div>
            `);

            const applySearchQuery = (queryText) => {
                filters.search = (queryText || '').trim();
                if (filters.search) saveSearchHistory(filters.search);
                header.find('.filter-search').text(filters.search ? `Поиск: ${filters.search}` : 'Поиск');
                this.updateFilterVisibility();
                this.resetAndReload();
                Lampa.Controller.toggle('content');
            };

            const openSearchModal = () => {
                let currentVal = filters.search || '';
                const history = getSearchHistory();

                const clockSvg = `<svg style="width: 1.1em; height: 1.1em; margin-right: 0.45em; opacity: 0.7; flex-shrink: 0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
                const searchSvg = `<svg style="width: 1.2em; height: 1.2em; margin-right: 0.6em; opacity: 0.8; flex-shrink: 0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

                const modalBody = $(`
                    <div class="seerr-native-search" style="padding: 0.5em 0.5em 1.5em 0.5em;">
                        <div style="display: flex; align-items: center; gap: 0.8em; margin-bottom: 1em;">
                            <div class="simple-button selector seerr-input-box" style="flex: 1; margin: 0; height: 3em; display: flex; align-items: center; justify-content: flex-start; padding: 0 1em; background: rgba(255,255,255,0.08); border-radius: 0.4em; font-size: 1.15em;">
                                ${searchSvg}
                                <span class="seerr-input-text">${currentVal || '<span style="opacity: 0.45;">Введите текст...</span>'}</span>
                            </div>
                            ${currentVal ? '<div class="simple-button selector seerr-btn-clear" style="margin: 0; height: 3em; display: inline-flex; align-items: center; padding: 0 1.2em;">Сбросить</div>' : ''}
                        </div>
                        <div class="seerr-history-chips" style="display: flex; flex-wrap: wrap; gap: 0.6em; margin-bottom: 1.5em;"></div>
                        <div style="font-size: 0.9em; opacity: 0.45;">Нажмите на строку выше для ввода текста или выберите запрос из истории.</div>
                    </div>
                `);

                const chipsContainer = modalBody.find('.seerr-history-chips');
                history.forEach(term => {
                    const chip = $(`
                        <div class="simple-button selector" style="margin: 0; display: inline-flex; align-items: center; padding: 0.55em 1em; background: rgba(255,255,255,0.07); border-radius: 0.35em; font-size: 0.95em;">
                            ${clockSvg}
                            <span>${term}</span>
                        </div>
                    `);
                    chip.on('hover:enter', () => {
                        Lampa.Modal.close();
                        applySearchQuery(term);
                    });
                    chipsContainer.append(chip);
                });

                modalBody.find('.seerr-input-box').on('hover:enter', () => {
                    Lampa.Modal.close();
                    Lampa.Input.edit({
                        title: 'Поиск',
                        value: currentVal,
                        free: true,
                        nosave: true
                    }, (newValue) => {
                        applySearchQuery(newValue);
                    });
                });

                modalBody.find('.seerr-btn-clear').on('hover:enter', () => {
                    Lampa.Modal.close();
                    applySearchQuery('');
                });

                Lampa.Modal.open({
                    title: 'Поиск',
                    html: modalBody,
                    size: 'large',
                    onBack: () => {
                        Lampa.Modal.close();
                        Lampa.Controller.toggle('content');
                    }
                });
            };
            header.find('.filter-search').on('hover:enter', openSearchModal);
            header.find('.filter-type').on('hover:enter', () => this.openSelect('Тип контента', TYPES, 'type', '.filter-type', 'Тип: '));
            header.find('.filter-genre').on('hover:enter', () => this.openSelect('Выберите жанр', GENRES, 'genre', '.filter-genre', 'Жанр: '));
            header.find('.filter-rating').on('hover:enter', () => this.openSelect('Минимальная оценка', RATINGS, 'rating', '.filter-rating', 'Оценка: '));
            header.find('.filter-sort').on('hover:enter', () => this.openSelect('Сортировка', SORTS, 'sort', '.filter-sort', 'Сортировка: '));
            header.find('.filter-lang').on('hover:enter', () => this.openSelect('Страна / Оригинал', LANGS, 'lang', '.filter-lang', 'Язык: '));

            header.find('.filter-year').on('hover:enter', () => {
                const selectItems = [
                    { title: '📅 Указать диапазон (от и до)...', value: 'range', selected: filters.year === 'range' }
                ];
                Object.keys(yearsList).forEach(key => {
                    selectItems.push({ title: yearsList[key], value: key, selected: filters.year === key });
                });

                Lampa.Select.show({
                    title: 'Год релиза или период',
                    items: selectItems,
                    onSelect: (selected) => {
                        if (selected.value !== 'range') {
                            filters.year = selected.value;
                            filters.yearFrom = '';
                            filters.yearTo = '';
                            html.find('.filter-year').text(getYearButtonText());
                            this.resetAndReload();
                            return;
                        }

                        Lampa.Input.edit({
                            title: 'Год ОТ (например: 2026)',
                            value: filters.yearFrom || String(new Date().getFullYear()),
                            free: true,
                            nosave: true
                        }, (fromVal) => {
                            const cleanFrom = (fromVal || '').replace(/\D/g, '').slice(0, 4);
                            setTimeout(() => {
                                Lampa.Input.edit({
                                    title: 'Год ДО (например: 2028)',
                                    value: filters.yearTo || '',
                                    free: true,
                                    nosave: true
                                }, (toVal) => {
                                    const cleanTo = (toVal || '').replace(/\D/g, '').slice(0, 4);
                                    if (!cleanFrom && !cleanTo) {
                                        filters.year = 'all';
                                        filters.yearFrom = '';
                                        filters.yearTo = '';
                                    } else {
                                        filters.year = 'range';
                                        if (cleanFrom && cleanTo && Number(cleanFrom) > Number(cleanTo)) {
                                            filters.yearFrom = cleanTo;
                                            filters.yearTo = cleanFrom;
                                        } else {
                                            filters.yearFrom = cleanFrom;
                                            filters.yearTo = cleanTo;
                                        }
                                    }
                                    html.find('.filter-year').text(getYearButtonText());
                                    this.resetAndReload();
                                    Lampa.Controller.toggle('content');
                                });
                            }, 200);
                        });
                    },
                    onBack: () => {
                        Lampa.Controller.toggle('content');
                    }
                });
            });

            scroll.append(header);
        };

        this.updateFilterVisibility = function () {
            const isSearch = Boolean(filters.search);
            html.find('.filter-genre, .filter-year, .filter-rating, .filter-lang').css('display', 'inline-flex');
            html.find('.filter-sort').css('display', isSearch ? 'none' : 'inline-flex');
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
                    if (filterKey === 'type') this.updateFilterVisibility();
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
            loaded_pages = { 1: true };
            last_focused_index = 0;
            SESSION_CACHE.state = null;
            body.empty();
            scroll.reset();
            this.activity.loader(true);
            this.loadData(false);
        };
        this.buildUrl = function (targetPage) {
            const domain = Lampa.Storage.get('seerr_url', '').replace(/\/+$/, '');

            if (filters.search) {
                return `${domain}/api/v1/search?query=${encodeURIComponent(filters.search)}&page=${targetPage}`;
            }

            const today = new Date().toISOString().slice(0, 10);
            const isMovie = filters.type === 'movie';
            const isNewSeasons = filters.type === 'tv_upcoming';
            const endpoint = isMovie ? '/api/v1/discover/movies' : '/api/v1/discover/tv';
            
            let sortValue = filters.sort;
            // Для сортировки "Ближайшая серия" запрашиваем у API популярные, а затем сортируем по точной дате nextEpisodeToAir
            if (sortValue === 'next_episode.asc') {
                sortValue = 'popularity.desc';
            } else if (sortValue === 'release_date.asc') {
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

            let gteDate = '';
            let lteDate = '';

            if (isNewSeasons) {
                lteDate = today;
                if (filters.year === 'range') {
                    if (filters.yearFrom) gteDate = `${filters.yearFrom}-01-01`;
                    if (filters.yearTo && `${filters.yearTo}-12-31` < today) {
                        lteDate = `${filters.yearTo}-12-31`;
                    }
                } else if (filters.year !== 'all') {
                    gteDate = `${filters.year}-01-01`;
                    if (`${filters.year}-12-31` < today) {
                        lteDate = `${filters.year}-12-31`;
                    }
                }
                // Защита от невозможного диапазона дат (gte > lte), вызывающего 500 в Seerr
                if (gteDate && lteDate && gteDate > lteDate) {
                    gteDate = '';
                }
            } else if (filters.year === 'range') {
                if (filters.yearFrom) {
                    gteDate = (filters.yearFrom === today.slice(0, 4)) ? today : `${filters.yearFrom}-01-01`;
                } else {
                    gteDate = today;
                }
                if (filters.yearTo) {
                    lteDate = `${filters.yearTo}-12-31`;
                }
                if (gteDate && lteDate && gteDate > lteDate) {
                    lteDate = '';
                }
            } else if (filters.year === 'all') {
                gteDate = today;
            } else {
                gteDate = (filters.year === today.slice(0, 4)) ? today : `${filters.year}-01-01`;
                lteDate = `${filters.year}-12-31`;
                if (gteDate > lteDate) lteDate = '';
            }

            if (gteDate) params.push(`${dateGteKey}=${encodeURIComponent(gteDate)}`);
            if (lteDate) params.push(`${dateLteKey}=${encodeURIComponent(lteDate)}`);

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
                this.handleResults(cached.results, append, currentPage);
                return;
            }

            network.timeout(10000);
            network.native(url, (json) => {
                this.activity.loader(false);

                if (json && json.results && json.results.length > 0) {
                    total_pages = json.totalPages || 1;
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
            const minRating = filters.rating !== 'all' ? Number(filters.rating) : 0;

            return rawResults.filter((el) => {
                // Фильтр по минимальной оценке
                if (minRating > 0) {
                    const score = Number(el.voteAverage || 0);
                    if (score < minRating) return false;
                }

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
                    const relYear = relDate ? relDate.slice(0, 4) : '';

                    if (filters.type !== 'tv_upcoming') {
                        if (filters.year === 'range') {
                            if (!relYear) return false;
                            if (filters.yearFrom && Number(relYear) < Number(filters.yearFrom)) return false;
                            if (filters.yearTo && Number(relYear) > Number(filters.yearTo)) return false;
                            if (filters.yearFrom === today.slice(0, 4) && relDate < today) return false;
                        } else if (filters.year === 'all') {
                            if (relDate && relDate < today) return false;
                        } else {
                            if (!relDate || !relDate.startsWith(filters.year)) return false;
                            if (filters.year === today.slice(0, 4) && relDate < today) return false;
                        }
                    } else if (filters.year === 'range' || filters.year !== 'all') {
                        if (!relYear) return false;
                        if (filters.year === 'range') {
                            if (filters.yearFrom && Number(relYear) < Number(filters.yearFrom)) return false;
                            if (filters.yearTo && Number(relYear) > Number(filters.yearTo)) return false;
                        } else if (relYear !== filters.year) {
                            return false;
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
            const needDetailsCheck = (filters.type === 'tv_upcoming') || (filters.type === 'tv' && filters.sort === 'next_episode.asc');

            if (needDetailsCheck && filtered.length > 0) {
                const domain = Lampa.Storage.get('seerr_url', '').replace(/\/+$/, '');
                const apiKey = Lampa.Storage.get('seerr_api_key', '');
                if (!SESSION_CACHE.tvDetails) SESSION_CACHE.tvDetails = {};

                let checkedCount = 0;
                const passedMap = {};

                const checkComplete = () => {
                    checkedCount++;
                    if (checkedCount === filtered.length) {
                        let resultList = filtered.filter(el => passedMap[el.id]);

                        // Сортировка по дате ближайшего выхода серии (от самой скорой к более поздним)
                        if (filters.sort === 'next_episode.asc') {
                            resultList.sort((a, b) => {
                                const dateA = a._nextAirDate || '9999-12-31';
                                const dateB = b._nextAirDate || '9999-12-31';
                                return dateA.localeCompare(dateB);
                            });
                        }

                        this.applyFilteredResults(resultList, append, currentPage);
                    }
                };

                const evaluateDetails = (item, details) => {
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

                    // Сохраняем дату ближайшей серии для сортировки
                    if (details.nextEpisodeToAir && details.nextEpisodeToAir.airDate) {
                        item._nextAirDate = details.nextEpisodeToAir.airDate;
                    } else if (seasonObj.airDate && seasonObj.airDate >= today) {
                        item._nextAirDate = seasonObj.airDate;
                    } else {
                        item._nextAirDate = '9999-12-31';
                    }

                    if (filters.type === 'tv_upcoming') {
                        const isOngoing = details.nextEpisodeToAir || ['Returning Series', 'In Production', 'Planned'].includes(details.status);
                        if (!isOngoing) return;
                        if (targetSeasonNum <= 1) return;

                        // 1. Отсекаем сезоны, где все серии уже вышли (например, "20 из 20")
                        if (totalEps > 0 && airedEps >= totalEps) return;

                        // 2. Если выбрана сортировка "Ближайшая серия", отсекаем пустые заглушки ("0 сер.") без даты выхода
                        if (filters.sort === 'next_episode.asc' && item._nextAirDate === '9999-12-31') {
                            return;
                        }

                        passedMap[item.id] = true;
                    } else {
                        passedMap[item.id] = true;
                    }
                };

                filtered.forEach((item) => {
                    if (SESSION_CACHE.tvDetails[item.id]) {
                        evaluateDetails(item, SESSION_CACHE.tvDetails[item.id]);
                        checkComplete();
                        return;
                    }

                    const tvReq = new Lampa.Reguest();
                    tvReq.native(`${domain}/api/v1/tv/${item.id}`, (details) => {
                        if (details) {
                            SESSION_CACHE.tvDetails[item.id] = details;
                            evaluateDetails(item, details);
                        }
                        checkComplete();
                    }, () => {
                        checkComplete();
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

            if (filters.sort === 'next_episode.asc' && SESSION_CACHE.state.itemsData.length > 1) {
                SESSION_CACHE.state.itemsData.sort((a, b) => {
                    const dateA = a._nextAirDate || '9999-12-31';
                    const dateB = b._nextAirDate || '9999-12-31';
                    return dateA.localeCompare(dateB);
                });
                items = [];
                body.empty();
                this.buildCards(SESSION_CACHE.state.itemsData);
            } else {
                this.buildCards(filtered);
            }

            if (!append) this.start();

            if (items.length < min_cards_buffer && currentPage < total_pages) {
                this.loadNextPage();
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

                if (showRating && cardData.vote_average > 0) {
                    const ratingVal = Number(cardData.vote_average).toFixed(1);
                    const ratingColor = ratingVal >= 7 ? '#2ecc71' : (ratingVal >= 5 ? '#f39c12' : '#e74c3c');
                    card.find('.card__view').append(
                        `<div class="seerr-rating-badge" style="background: rgba(0, 0, 0, 0.78); color: ${ratingColor}; font-weight: 700; font-size: 0.85em; padding: 0.25em 0.5em; border-radius: 0.3em; position: absolute; top: 0.5em; left: 0.5em; z-index: 2;">★ ${ratingVal}</div>`
                    );
                }

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
