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

    const GENRES = {
        all: 'Все жанры', 28: 'Боевик', 12: 'Приключения', 16: 'Мультфильм',
        35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма',
        10751: 'Семейный', 14: 'Фэнтези', 36: 'История', 27: 'Ужасы',
        10402: 'Музыка', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика',
        53: 'Триллер', 10752: 'Военный', 37: 'Вестерн'
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
        'popularity.desc': 'Популярные (сначала хиты)',
        'release_date.asc': 'По дате (ближайшие)',
        'release_date.desc': 'По дате (самые дальние)',
        'vote_average.desc': 'По рейтингу (высокий)',
        'vote_count.desc': 'По количеству оценок',
        'original_title.asc': 'По названию (А-Я)'
    };

    function getYearsList() {
        const currentYear = new Date().getFullYear();
        const years = { all: 'Все годы (будущие)' };
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
        let min_cards_buffer = 40; // Держим минимум 40 отфильтрованных карточек в буфере

        let filters = SESSION_CACHE.state ? Object.assign({}, SESSION_CACHE.state.filters) : {
            type: 'movie',
            genre: 'all',
            year: 'all',
            sort: 'popularity.desc',
            lang: 'all'
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
            const header = $(`
                <div class="seerr-filter-bar" style="padding: 1.5em 1.5em 0.5em 1.5em; display: flex; gap: 1em; flex-wrap: wrap;">
                    <div class="simple-button selector filter-type">Тип: ${filters.type === 'movie' ? 'Фильмы' : 'Сериалы'}</div>
                    <div class="simple-button selector filter-genre">Жанр: ${GENRES[filters.genre] || 'Все жанры'}</div>
                    <div class="simple-button selector filter-year">Год: ${yearsList[filters.year] || 'Все годы'}</div>
                    <div class="simple-button selector filter-sort">Сортировка: ${SORTS[filters.sort] || 'Популярные'}</div>
                    <div class="simple-button selector filter-lang">Язык: ${LANGS[filters.lang] || 'Все страны'}</div>
                </div>
            `);

            header.find('.filter-type').on('hover:enter', () => this.openSelect('Тип контента', {
                movie: 'Фильмы',
                tv: 'Сериалы'
            }, 'type', '.filter-type', 'Тип: '));

            header.find('.filter-genre').on('hover:enter', () => this.openSelect('Выберите жанр', GENRES, 'genre', '.filter-genre', 'Жанр: '));
            header.find('.filter-year').on('hover:enter', () => this.openSelect('Год релиза', yearsList, 'year', '.filter-year', 'Год: '));
            header.find('.filter-sort').on('hover:enter', () => this.openSelect('Сортировка', SORTS, 'sort', '.filter-sort', 'Сортировка: '));
            header.find('.filter-lang').on('hover:enter', () => this.openSelect('Страна / Оригинал', LANGS, 'lang', '.filter-lang', 'Язык: '));

            scroll.append(header);
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
            const today = new Date().toISOString().slice(0, 10);
            const isMovie = filters.type === 'movie';
            const endpoint = isMovie ? '/api/v1/discover/movies' : '/api/v1/discover/tv';
            
            // Маппинг сортировки отдельно для фильмов и сериалов
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
                // Если выбран текущий год — берем от сегодняшнего дня до конца года, чтобы не показывать прошедшие
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

            return rawResults.filter((el) => {
                // Для фильмов отсекаем прошедшие даты; для сериалов пропускаем (т.к. у новых сезонов firstAirDate в прошлом)
                if (filters.type === 'movie') {
                    const relDate = el.releaseDate || '';
                    if (relDate && relDate < today) return false;
                }

                // 2. Фильтр: скрывать без постера
                if (hideNoPoster && !el.posterPath) return false;

                // 3. Фильтр: только с русским названием или описанием
                if (onlyRu) {
                    const title = el.title || el.name || '';
                    const overview = el.overview || '';
                    if (!hasCyrillic(title) && !hasCyrillic(overview)) return false;
                }

                return true;
            });
        };

        this.handleResults = function (rawResults, append, currentPage) {
            const filtered = this.filterResults(rawResults);

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

            // Докачиваем страницы в буфер, пока не наберется минимум 40 подходящих карточек
            if (items.length < min_cards_buffer && currentPage < total_pages) {
                setTimeout(() => this.loadNextPage(), 120);
            } else if (items.length === 0 && currentPage >= total_pages) {
                body.append('<div class="empty__title" style="padding: 2em;">По заданным фильтрам ничего не найдено</div>');
            }
        };

        this.buildCards = function (results) {
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
                    media_type: filters.type
                };

                const card = Lampa.Template.get('card', {
                    title: cardData.title,
                    release_year: cardData.release_date ? cardData.release_date.slice(0, 4) : 'Скоро'
                });

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
                        method: filters.type,
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