import React, { useState, useEffect } from 'react';
import { Link } from 'react-scroll';

const Navigation: React.FC = () => {
  const [screenWidth, setScreenWidth] = useState(window.innerWidth);
  const [isDropdownVisible, setDropdownVisible] = useState(false);

  const scrollOffset = 80;
  const screenBreakPoint = 600;

  useEffect(() => {
    const handleResize = () => {
      setScreenWidth(window.innerWidth);
    };
    // Initial setup
    handleResize();

    // Attach event listeners
    window.addEventListener('resize', handleResize);

    // Cleanup on component unmount
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const toggleDropdown = () => {
    setDropdownVisible(!isDropdownVisible);
  };

  const scrollTo = (elementId: string) => {
    const element = document.getElementById(elementId);

    if (element) {
      const offset = element.offsetTop - scrollOffset; // Adjust this value as needed
      window.scrollTo({
        top: offset,
        behavior: 'smooth',
      });
    }

    setDropdownVisible(false); // Close the dropdown after clicking a link
  };

  return (
    <nav className={`fixed w-full m-0 h-20 z-1 xl:block bg-dark`}>
      <div className='flex items-center justify-start h-full px-4'>
        <div className='relative inline-block cursor-pointer w-44'>
          <h2
            onClick={() => scrollTo('introduceElement')}
            className='font-medium transition-transform duration-300 ease-in-out text-nowrap hover:scale-105'
          >
            <strong className='font-normal text-lightBlue'>{'<'}</strong>
            {'Veeti Sorakivi'}
            <strong className='font-normal text-lightBlue '>{' />'}</strong>
          </h2>
        </div>
        <div className='relative inline-flex items-center justify-end w-full h-full'>
          {screenWidth > screenBreakPoint ? (
            <ul className='w-full h-full'>
              <li className='inline-flex items-center justify-start h-full nav-item group'>
                <Link
                  to='introduceElement'
                  spy={true}
                  smooth={true}
                  duration={800}
                  offset={-scrollOffset}
                  className='px-2 py-1 text-sm cursor-pointer'
                >
                  Introduction
                </Link>
              </li>
              <li className='inline-flex items-center justify-start h-full nav-item group'>
                <Link
                  to='skillsElement'
                  spy={true}
                  smooth={true}
                  duration={800}
                  offset={-scrollOffset}
                  className='px-2 py-1 text-sm cursor-pointer'
                >
                  Skills
                </Link>
              </li>
              <li className='inline-flex items-center justify-start h-full nav-item group'>
                <Link
                  to='projectsElement'
                  spy={true}
                  smooth={true}
                  duration={800}
                  offset={-scrollOffset}
                  className='px-2 py-1 text-sm cursor-pointer'
                >
                  Projects
                </Link>
              </li>
              <li className='inline-flex items-center justify-start h-full nav-item group'>
                <Link
                  to='contactElement'
                  spy={true}
                  smooth={true}
                  duration={800}
                  offset={-scrollOffset}
                  className='px-2 py-1 text-sm cursor-pointer'
                >
                  Contact
                </Link>
              </li>
            </ul>
          ) : (
            <div className='h-full'>
              <div className='flex items-center h-full'>
                <button
                  className='flex items-center gap-2 transition-transform transform text-md lg:hidden hover:scale-105'
                  onClick={toggleDropdown}
                >
                  MENU
                  <i
                    className={`text-xl w-5 text-lightBlue fa-solid ${
                      isDropdownVisible ? 'fa-x' : 'fa-bars'
                    }`}
                  ></i>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className='fixed group-hover:visible'></div>
      </div>
      {isDropdownVisible && screenWidth < screenBreakPoint && (
        <ul className='absolute w-screen p-2 transition-transform ease-in-out origin-top transform border-t-2 bg-dark bg-opacity-90 border-lightBlue'>
          <li className='block py-2 text-center'>
            <button
              onClick={() => scrollTo('introduceElement')}
              className='text-md'
            >
              Introduction
            </button>
          </li>
          <li className='block py-2 text-center'>
            <button
              onClick={() => scrollTo('skillsElement')}
              className='text-md'
            >
              Skills
            </button>
          </li>
          <li className='block py-2 text-center'>
            <button
              onClick={() => scrollTo('projectsElement')}
              className='text-md'
            >
              Projects
            </button>
          </li>
          <li className='block py-2 text-center'>
            <button
              onClick={() => scrollTo('contactElement')}
              className='text-md'
            >
              Contact
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
};

export default Navigation;
